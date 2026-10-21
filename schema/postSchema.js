import mongoose from "mongoose";
import { normalizeTags } from "../utils/validation.js";

const postSchema = new mongoose.Schema({
    postImage: { type: String },
    imageWidth: { type: Number },
    imageHeight: { type: Number },
    postTitle: { type: String, required: true, trim: true, maxlength: 100 },
    postDescription: { type: String, trim: true, maxlength: 1000 },
    url: { type: String },
    tags:{type:Array},
    location: { type: String, trim: true },
    saved: {type:[String],default:[]},
    adminStrike:{type:Boolean,default:false},
    // Ids of the users who marked this post as "not interested"
    interested: {type:[String],default:[]},
    archive: {type:Boolean,default:false},
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  }, { timestamps: true });

postSchema.index({ createdAt: -1 })
postSchema.index({ userId: 1, createdAt: -1 })
postSchema.index({ saved: 1 })
postSchema.index({ interested: 1 })

// Older posts stored tags in mixed formats; always send a clean array.
postSchema.set('toJSON', {
    transform: (doc, ret) => {
        ret.tags = normalizeTags(ret.tags)
        delete ret.__v
        return ret
    }
})

export default mongoose.model('Post',postSchema)
