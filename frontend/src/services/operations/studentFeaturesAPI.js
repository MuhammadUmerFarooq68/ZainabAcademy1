import { toast } from "react-hot-toast";
import { studentEndpoints } from "../apis";
import { apiConnector } from "../apiConnector";
import rzpLogo from "../../assets/Logo/rzp_logo.png"
import { setPaymentLoading } from "../../slices/courseSlice";
import { resetCart } from "../../slices/cartSlice";


const { COURSE_PAYMENT_API, COURSE_VERIFY_API, SEND_PAYMENT_SUCCESS_EMAIL_API } = studentEndpoints;

const loadScript = (url) => {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.onload = () => resolve(true);
        script.onerror = () => reject(new Error('Script load error'));
        document.body.appendChild(script);
    });
};
// ================ buyCourse ================ 
export async function buyCourse(token, coursesId, userDetails, navigate, dispatch) {
    const toastId = toast.loading("Loading...");

    try {
        // Load the JazzCash SDK
        const res = await loadScript("https:// "); // Replace with actual SDK URL

        if (!res) {
            toast.error("JazzCash SDK failed to load");
            return;
        }

        // Initiate the order
        const orderResponse = await apiConnector("POST", COURSE_PAYMENT_API,
            { coursesId },
            {
                Authorization: `Bearer ${token}`,
            });

        if (!orderResponse.data.success) {
            throw new Error(orderResponse.data.message);
        }

        // JazzCash Payment Handling (Replace this part with actual JazzCash payment process)
        const paymentOptions = {
            key: orderResponse.data.message.key, // Use JazzCash-specific key
            amount: orderResponse.data.message.amount,
            description: "Thank You for Purchasing the Course",
            // Additional JazzCash-specific options here
            handler: function (response) {
                sendPaymentSuccessEmail(response, orderResponse.data.message.amount, token);
                verifyPayment({ ...response, coursesId }, token, navigate, dispatch);
            }
        };

        // Initialize and open the payment object for JazzCash (replace with correct method)
        const paymentObject = new window.JazzCash(paymentOptions); 
        paymentObject.open();

        paymentObject.on("payment.failed", function (response) {
            toast.error("Oops, payment failed");
            console.log("Payment failed: ", response.error);
        });

    } catch (error) {
        console.log("PAYMENT API ERROR: ", error);
        toast.error(error.response?.data?.message || "Could not make Payment");
    }

    toast.dismiss(toastId);
}


// ================ send Payment Success Email ================
async function sendPaymentSuccessEmail(response, amount, token) {
    try {
        await apiConnector("POST", SEND_PAYMENT_SUCCESS_EMAIL_API, {
            orderId: response.razorpay_order_id,
            paymentId: response.razorpay_payment_id,
            amount,
        }, {
            Authorization: `Bearer ${token}`
        })
    }
    catch (error) {
        console.log("PAYMENT SUCCESS EMAIL ERROR....", error);
    }
}


// ================ verify payment ================
async function verifyPayment(bodyData, token, navigate, dispatch) {
    const toastId = toast.loading("Verifying Payment....");
    dispatch(setPaymentLoading(true));

    try {
        const response = await apiConnector("POST", COURSE_VERIFY_API, bodyData, {
            Authorization: `Bearer ${token}`,
        })

        if (!response.data.success) {
            throw new Error(response.data.message);
        }
        toast.success("payment Successful, you are addded to the course");
        navigate("/dashboard/enrolled-courses");
        dispatch(resetCart());
    }
    catch (error) {
        console.log("PAYMENT VERIFY ERROR....", error);
        toast.error("Could not verify Payment");
    }
    toast.dismiss(toastId);
    dispatch(setPaymentLoading(false));
}