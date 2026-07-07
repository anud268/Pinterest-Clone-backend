import mongoose from "mongoose";

const adminCardSchema = mongoose.Schema({
    image:{type:String, required:true},
    title:{type:String, required:true},
    subtitle:{type:String, }
},{timestamps:true})

export default mongoose.model('Card',adminCardSchema)