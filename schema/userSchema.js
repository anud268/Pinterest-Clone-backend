import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
    email:{type:String,required:true},
    fullname:{type:String,required:true},
    password:{type:String,required:true},
    role:{type:String,default:"user"},
    adminblock:{type:Boolean,default:false},
    userblock: {type:[String],default:[]},
    profile: { type: mongoose.Schema.Types.ObjectId, ref: "Profile" }
},{timestamps: true})

export default mongoose.model('User',userSchema) 


