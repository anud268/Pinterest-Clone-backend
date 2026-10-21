import mongoose from "mongoose";

export const OTP_TTL_SECONDS = 10 * 60

const otpSchema = mongoose.Schema({
    email: { type: String, required: true },
    // bcrypt hash of the code; the plain code only ever leaves the server by email
    otp: {type:String, required:true},
    attempts: { type: Number, default: 0 },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
},{timestamps: true})

otpSchema.index({ email: 1 })
// MongoDB removes codes automatically once they expire
otpSchema.index({ createdAt: 1 }, { expireAfterSeconds: OTP_TTL_SECONDS })

export default mongoose.model('Otp',otpSchema)
