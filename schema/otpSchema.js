    import mongoose from "mongoose";

    const otpSchema = mongoose.Schema({
        email: { type: String, required: true },
        otp: {type:String, required:true},
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
    },{timestamps: true})
    export default mongoose.model('Otp',otpSchema)