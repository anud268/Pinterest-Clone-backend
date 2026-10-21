import nodemailer from 'nodemailer';
import { HttpError } from '../utils/http.js';

let transporter;

const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL, pass: process.env.EMAIL_PASS },
    });
  }
  return transporter;
};

const mailConfigured = () => Boolean(process.env.EMAIL && process.env.EMAIL_PASS);

export const sendOtpEmail = async (email, otp, ttlMinutes) => {
  if (!mailConfigured()) {
    // Local development without mail credentials: print the code instead of failing sign-up.
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[Mail] EMAIL/EMAIL_PASS not set. OTP for ${email}: ${otp}`);
      return;
    }
    throw new HttpError(503, 'Email delivery is not configured on the server');
  }

  try {
    await getTransporter().sendMail({
      from: process.env.EMAIL,
      to: email,
      subject: 'Your verification code',
      text: `Your verification code is ${otp}. It expires in ${ttlMinutes} minutes.`,
      html: `<p>Your verification code is</p><h2 style="letter-spacing:4px">${otp}</h2><p>It expires in ${ttlMinutes} minutes. If you didn't request it, you can ignore this email.</p>`,
    });
  } catch (error) {
    console.error('[Mail] Failed to send OTP:', error.message);
    throw new HttpError(502, 'We could not send the verification email. Please try again.');
  }
};
