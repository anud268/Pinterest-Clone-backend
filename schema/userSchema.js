import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
    email:{type:String,required:true,trim:true},
    fullname:{type:String,required:true,trim:true},
    // Never returned by queries unless explicitly requested with .select('+password')
    password:{type:String,required:true,select:false},
    role:{type:String,default:"user"},
    adminblock:{type:Boolean,default:false},
    // Ids of the users who have blocked this user
    userblock: {type:[String],default:[]},
    // Accounts created before email verification existed have no value and are treated as verified
    emailVerified:{type:Boolean},
    profile: { type: mongoose.Schema.Types.ObjectId, ref: "Profile" }
},{timestamps: true})

userSchema.index({ email: 1 }, { unique: true })
userSchema.index({ userblock: 1 })

userSchema.set('toJSON', {
    transform: (doc, ret) => {
        delete ret.password
        delete ret.__v
        return ret
    }
})

export default mongoose.model('User',userSchema)
