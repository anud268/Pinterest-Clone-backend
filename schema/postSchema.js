import mongoose from "mongoose";

const postSchema = new mongoose.Schema({
    postImage: { type: String },
    postTitle: { type: String, required: true },
    postDescription: { type: String },
    url: { type: String },
    tags:{type:Array},
    location: { type: String, },
    saved: {type:[String],default:[]},
    adminStrike:{type:Boolean,default:false},
    interested: {type:[String],default:[]},
    archive: {type:Boolean,default:false},
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    // profile: { type: mongoose.Schema.Types.ObjectId, ref: "Profile" }
  }, { timestamps: true });

  export default mongoose.model('Post',postSchema)