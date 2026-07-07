import mongoose from "mongoose";

const tagSchema = mongoose.Schema({
    category :{type:String ,unique:true},   
    tags :{type:Array}
},{timestamps:true})

export default mongoose.model('Tag',tagSchema)