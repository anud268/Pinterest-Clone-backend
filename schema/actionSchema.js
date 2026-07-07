import mongoose from "mongoose";

const actionSchema = mongoose.Schema({
    post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
    saved:{type:[String], default:[] },
    likes:{type:[String], default:[] },
    comments:[{userId: String,text: String,date: { type: Date, default: Date.now }}],
    archived:{type:[String], default:[] },
},{timestamps:true})

export default mongoose.model('Action',actionSchema)