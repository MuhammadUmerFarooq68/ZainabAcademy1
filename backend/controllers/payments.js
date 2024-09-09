const Jazzcash = require('../config/jazzcash');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const User = require('../models/user');
const Course = require('../models/course');
const CourseProgress = require('../models/courseProgress');
const mailSender = require('../utils/mailSender');
const { courseEnrollmentEmail, paymentSuccessEmail } = require('../mail/templates/courseEnrollmentEmail');

// Capture the Payment and Initiate JazzCash Order
exports.capturePayment = async (req, res) => {
    try {
        const { userId, courseId, amount, returnURL } = req.body;
    
        // Check if Jazzcash is initialized
        if (!Jazzcash.initialized) {
          throw new Error("Jazzcash is not initialized properly.");
        }
    
        // Fetch User and Course
        const user = await User.findById(userId);
        if (!user) {
          return res.status(404).json({
            success: false,
            message: 'User not found',
          });
        }
    
        const course = await Course.findById(courseId);
        if (!course) {
          return res.status(404).json({
            success: false,
            message: 'Course not found',
          });
        }
    
        // Prepare Payment Data
        const paymentData = {
          pp_Amount: amount,
          pp_BankID: "", // Add bank ID if needed
          pp_BillReference: `CRS-${courseId}-${userId}-${new Date().getTime()}`,
          pp_Description: `Payment for course ${course.courseName}`,
          pp_Language: "EN",
          pp_MerchantID: Jazzcash.config.merchantId,
          pp_Password: Jazzcash.config.password,
          pp_ProductID: course._id,
          pp_ReturnURL: returnURL,
          pp_TxnCurrency: "PKR",
          pp_TxnDateTime: getDateTime(),
          pp_TxnExpiryDateTime: getDateTime(1), // 1 day expiry
          pp_TxnRefNo: `TXN-${new Date().getTime()}`,
          pp_TxnType: "SALE",
          pp_Version: "1.1",
          ppmpf_1: "",
          ppmpf_2: "",
          ppmpf_3: "",
          ppmpf_4: "",
          ppmpf_5: "",
          pp_MobileNumber: user.mobileNumber || "", // Assuming user model has mobileNumber field
          pp_CNIC: user.cnic || "", // Assuming user model has cnic field
        };
    
        // Set Data and Create Payment Request
        Jazzcash.setData(paymentData);
        const paymentRequest = await Jazzcash.createRequest('PAY');
    
        // Respond with the payment request
        return res.status(200).json({
          success: true,
          message: 'Payment request created successfully',
          data: paymentRequest,
        });
    
      } catch (error) {
        console.error("Error creating payment request:", error);
        return res.status(500).json({
          success: false,
          message: 'Failed to create payment request',
          error: error.message,
        });
      }
    }
    // Helper function to get current datetime
function getDateTime(dayOffset = 0) {
    let date = new Date();
    date.setDate(date.getDate() + dayOffset);
    return date.toISOString().replace(/\.\d+Z$/, '').replace('T', ' ');
  }
  

// Verify the Payment
exports.verifyPayment = async (req, res) => {
  try {
      const { txnRefNo, userId, courseId } = req.body;
      console.log("Received Data:", { txnRefNo, userId, courseId });

      // Ensure Jazzcash is initialized
      if (!Jazzcash.initialized) {
          throw new Error("Jazzcash is not initialized properly.");
      }

      // Set verification data
      Jazzcash.setData({
          pp_TxnRefNo: txnRefNo,  // Transaction reference number for verification
      });

      console.log("Sending pp_TxnRefNo:", txnRefNo);

      // Create verification request
      const verificationRequest = await Jazzcash.createRequest('INQUIRY');
      
      // Parse the response
      let response;
      try {
          response = JSON.parse(verificationRequest);
      } catch (err) {
          return res.status(500).json({
              success: false,
              message: 'Failed to parse response from Jazzcash',
              error: err.message,
          });
      }

      // Check if the verification response indicates success
      if (response && response.pp_ResponseCode === "000") {
          // Payment verified successfully
          const user = await User.findById(userId);
          if (!user) {
              return res.status(404).json({
                  success: false,
                  message: 'User not found',
              });
          }

          const course = await Course.findById(courseId);
          if (!course) {
              return res.status(404).json({
                  success: false,
                  message: 'Course not found',
              });
          }

          // Update course progress
          const courseProgress = await CourseProgress.findOne({
              courseID: courseId,
              userId: userId,
          });

          if (courseProgress) {
              // If course progress already exists, update it
              courseProgress.completedVideos.push(...(response.completedVideos || [])); 
              await courseProgress.save();
          } else {
              // Create new course progress entry
              await CourseProgress.create({
                  courseID: courseId,
                  userId: userId,
                  completedVideos: response.completedVideos || [],
              });
          }

          return res.status(200).json({
              success: true,
              message: 'Payment verified and course progress updated successfully',
              data: response,
          });
      } else {
          // Payment verification failed
          return res.status(400).json({
              success: false,
              message: response.pp_ResponseMessage || 'Payment verification failed',
              data: response,
          });
      }

  } catch (error) {
      return res.status(500).json({
          success: false,
          message: 'Payment verification failed',
          error: error.message,
      });
  }
};


// Enroll Students to Course After Payment
const enrollStudents = async (courses, userId, res) => {
    if (!courses || !userId) {
        return res.status(400).json({ success: false, message: "Please provide data for courses or userId" });
    }

    for (const courseId of courses) {
        try {
            const enrolledCourse = await Course.findOneAndUpdate(
                { _id: courseId },
                { $push: { studentsEnrolled: userId } },
                { new: true },
            );

            if (!enrolledCourse) {
                return res.status(500).json({ success: false, message: "Course not found" });
            }

            const courseProgress = await CourseProgress.create({
                courseID: courseId,
                userId: userId,
                completedVideos: [],
            });

            const enrolledStudent = await User.findByIdAndUpdate(
                userId,
                {
                    $push: {
                        courses: courseId,
                        courseProgress: courseProgress._id,
                    },
                },
                { new: true }
            );

            await mailSender(
                enrolledStudent.email,
                `Successfully Enrolled into ${enrolledCourse.courseName}`,
                courseEnrollmentEmail(enrolledCourse.courseName, `${enrolledStudent.firstName}`)
            );
        } catch (error) {
            console.log(error);
            return res.status(500).json({ success: false, message: error.message });
        }
    }
};

// Send Payment Success Email
exports.sendPaymentSuccessEmail = async (req, res) => {
    const { orderId, paymentId, amount } = req.body;
    const userId = req.user.id;

    if (!orderId || !paymentId || !amount || !userId) {
        return res.status(400).json({ success: false, message: "Please provide all the fields" });
    }

    try {
        const enrolledStudent = await User.findById(userId);
        await mailSender(
            enrolledStudent.email,
            `Payment Received`,
            paymentSuccessEmail(`${enrolledStudent.firstName}`, amount / 100, orderId, paymentId)
        );
        res.status(200).json({ success: true, message: "Email sent successfully" });
    } catch (error) {
        console.log("Error in sending mail", error);
        return res.status(500).json({ success: false, message: "Could not send email" });
    }
};

