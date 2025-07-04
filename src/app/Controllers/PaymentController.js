import { sortObject } from "../../utils/sortObj.js";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import Payment from "../Models/PaymentModel.js";
import OrderModel from "../Models/OrderModel.js";
import UserModel from "../Models/UserModel.js";
import axios from "axios";
import crypto from "crypto";
import dateFormat from "dateformat";
import querystring from "qs";

dotenv.config();

export const createPayment = async (req, res) => {
  const userId = req.user._id;
  const user = await UserModel.findById(userId);
  try {
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Vui lòng đăng nhập để thanh toán",
      });
    }
    const { orderId, totalAmount, paymentMethod } = req.body;
    const order = await OrderModel.findById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy đơn hàng",
      });
    }
    if (order.paymentStatus === "paid") {
      return res.status(400).json({
        success: false,
        message: "Đơn hàng đã được thanh toán",
      });
    }

    // Tạo bản ghi payment mới
    const payment = await Payment.create({
      orderId: orderId,
      amount: totalAmount,
      status: "pending",
      paymentMethod: paymentMethod,
    });
    order.paymentInfo = payment._id;
    await order.save();

    if (paymentMethod === "vnpay") {
      var ipAddr =
        req.headers["x-forwarded-for"] ||
        req.connection.remoteAddress ||
        req.socket.remoteAddress ||
        req.connection.socket.remoteAddress ||
        req.ip ||
        "127.0.0.1";

      var tmnCode = process.env.VNPAY_TMN_CODE;
      var secretKey = process.env.VNPAY_HASH_SECRET;
      var vnpUrl = "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html";
      var returnUrl = process.env.VNPAY_RETURN_URL;

      var date = new Date();
      var createDate = dateFormat(date, "yyyymmddHHmmss");
      var expireDate = new Date(date.getTime() + 15 * 60 * 1000);
      var vnp_ExpireDate = dateFormat(expireDate, "yyyymmddHHmmss");

      var orderInfo = `Thanh toan don hang ${orderId}`;
      var orderType = "Other";
      var locale = "vn";
      var currCode = "VND";

      var vnp_Params = {};
      vnp_Params["vnp_Version"] = "2.1.0";
      vnp_Params["vnp_Command"] = "pay";
      vnp_Params["vnp_TmnCode"] = tmnCode;
      vnp_Params["vnp_Locale"] = locale;
      vnp_Params["vnp_CurrCode"] = currCode;
      vnp_Params["vnp_TxnRef"] = orderId;
      vnp_Params["vnp_OrderInfo"] = orderInfo;
      vnp_Params["vnp_OrderType"] = orderType;
      vnp_Params["vnp_Amount"] = totalAmount * 100;
      vnp_Params["vnp_ReturnUrl"] = returnUrl;
      vnp_Params["vnp_IpAddr"] = ipAddr;
      vnp_Params["vnp_CreateDate"] = createDate;
      vnp_Params["vnp_ExpireDate"] = vnp_ExpireDate;

      vnp_Params = sortObject(vnp_Params);

      var signData = querystring.stringify(vnp_Params, { encode: false });
      var hmac = crypto.createHmac("sha512", secretKey);
      var signed = hmac.update(Buffer.from(signData, "utf-8")).digest("hex");
      vnp_Params["vnp_SecureHash"] = signed;
      vnpUrl += "?" + querystring.stringify(vnp_Params, { encode: false });

      return res.status(200).json({
        success: true,
        data: vnpUrl,
      });
    } else if (paymentMethod === "momo") {
      var partnerCode = "MOMO";
      var accessKey = "F8BBA842ECF85";
      var secretkey = "K951B6PE1waDMi640xX08PD3vg6EkVlz";
      var requestId = orderId;
      var orderInfo = `Thanh toan don hang ${orderId}`;
      var redirectUrl =
        process.env.MOMO_RETURN_URL ||
        "http://localhost:5000/api/v1/payment/result-momo";
      var ipnUrl =
        process.env.MOMO_IPN_URL ||
        "http://localhost:5000/api/v1/payment/result-momo";
      var amount = totalAmount;
      var requestType = "captureWallet";
      var extraData = ""; //pass empty value if your merchant does not have stores

      var rawSignature =
        "accessKey=" +
        accessKey +
        "&amount=" +
        amount +
        "&extraData=" +
        extraData +
        "&ipnUrl=" +
        ipnUrl +
        "&orderId=" +
        orderId +
        "&orderInfo=" +
        orderInfo +
        "&partnerCode=" +
        partnerCode +
        "&redirectUrl=" +
        redirectUrl +
        "&requestId=" +
        requestId +
        "&requestType=" +
        requestType;
      //puts raw signature

      //signature
      var signature = crypto
        .createHmac("sha256", secretkey)
        .update(rawSignature)
        .digest("hex");

      //json object send to MoMo endpoint
      const requestBody = JSON.stringify({
        partnerCode: partnerCode,
        accessKey: accessKey,
        requestId: requestId,
        amount: amount,
        orderId: orderId,
        orderInfo: orderInfo,
        redirectUrl: redirectUrl,
        ipnUrl: ipnUrl,
        extraData: extraData,
        requestType: requestType,
        signature: signature,
        lang: "en",
      });
      const response = await axios.post(
        "https://test-payment.momo.vn/v2/gateway/api/create",
        requestBody,
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
      return res.status(200).json({
        success: true,
        message: "Tạo thanh toán thành công",
        data: response.data.payUrl,
      });
    } else if (paymentMethod === "cod") {
      // Update order status to shipping for COD orders
      order.status = "shipping";
      await order.save();

      // Clear user's cart
      user.cart = [];
      await user.save();

      return res.status(200).json({
        success: true,
        message: "Đặt hàng COD thành công",
        data: {
          orderId: order._id,
          paymentStatus: payment.status,
          orderStatus: order.status,
        },
      });
    }
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const handlePaymenWithVNPaySuccess = async (req, res) => {
  console.log("VNPAY CALLBACK:", req.query);
  try {
    const {
      vnp_PayDate,
      vnp_ResponseCode,
      vnp_TransactionNo,
      vnp_TransactionStatus,
      vnp_TxnRef,
    } = req.query;

    // Tìm payment record dựa trên orderId
    const payment = await Payment.findOne({ orderId: vnp_TxnRef });
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy thông tin thanh toán",
      });
    }

    // Tìm đơn hàng tương ứng và populate paymentInfo
    const order = await OrderModel.findById(vnp_TxnRef);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy đơn hàng",
      });
    }

    // Cập nhật trạng thái thanh toán
    const isSuccess = vnp_ResponseCode === "00";
    payment.status = isSuccess ? "completed" : "failed";
    payment.transactionId = bcrypt.hashSync(vnp_TransactionNo, 10);
    const year = vnp_PayDate.substring(0, 4);
    const month = vnp_PayDate.substring(4, 6);
    const day = vnp_PayDate.substring(6, 8);
    const hour = vnp_PayDate.substring(8, 10);
    const minute = vnp_PayDate.substring(10, 12);
    const second = vnp_PayDate.substring(12, 14);
    const paymentDate = new Date(year, month - 1, day, hour, minute, second);
    payment.paymentDate = paymentDate;
    payment.responseCode = vnp_ResponseCode;
    payment.responseMessage =
      vnp_TransactionStatus === "00"
        ? "Thanh toán thành công"
        : "Thanh toán thất bại";
    await payment.save();

    // Cập nhật trạng thái đơn hàng
    if (isSuccess) {
      order.status = "shipping";
      await order.save();

      // Tìm và cập nhật giỏ hàng của user
      const user = await UserModel.findById(order.user);
      if (user) {
        user.cart = [];
        await user.save();
      }
    }

    // Redirect về trang frontend với thông tin thanh toán
    return res.redirect(
      process.env.FRONTEND_URL ||
        "http://localhost:3000" +
          `/payment-status/result?status=${payment.status}&orderId=${payment.orderId}`
    );
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const handlePaymentWithMomoSuccess = async (req, res) => {
  console.log("MOMO CALLBACK:", req.query);
  try {
    // In log để debug các trường MOMO gửi về
    const { orderId, transId, resultCode, message } = req.query;

    // Tìm payment record dựa trên orderId
    const payment = await Payment.findOne({ orderId });
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy thông tin thanh toán",
      });
    }

    // Tìm đơn hàng tương ứng
    const order = await OrderModel.findById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy đơn hàng",
      });
    }

    // Cập nhật trạng thái thanh toán
    const isSuccess = resultCode === "0";
    payment.status = isSuccess ? "completed" : "failed";
    payment.transactionId = bcrypt.hashSync(transId, 10);
    payment.paymentDate = new Date();
    payment.responseCode = resultCode;
    payment.responseMessage =
      message === "Successful."
        ? "Thanh toán thành công"
        : "Thanh toán thất bại";
    await payment.save();

    // Cập nhật trạng thái đơn hàng nếu thành công
    if (isSuccess) {
      order.status = "shipping";
      await order.save();

      // Xóa giỏ hàng user nếu cần
      const user = await UserModel.findById(order.user);
      if (user) {
        user.cart = [];
        await user.save();
      }
    }

    // Redirect về FE
    return res.redirect(
      process.env.FRONTEND_URL ||
        "http://localhost:3000" +
          `/payment-status/result?status=${payment.status}&orderId=${payment.orderId}`
    );
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// API lấy thông tin thanh toán
export const getPaymentInfo = async (req, res) => {
  try {
    const { orderId } = req.params;

    // Tìm đơn hàng và populate paymentInfo
    const order = await OrderModel.findById(orderId).populate("paymentInfo");
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy đơn hàng",
      });
    }

    return res.status(200).json({
      success: true,
      data: order.paymentInfo,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
