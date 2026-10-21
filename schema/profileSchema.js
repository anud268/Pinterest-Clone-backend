import mongoose from "mongoose";
const profileSchema = new mongoose.Schema({
    image:{type:String , default:null},
    bio:{type:String , default:null},
    country:{type:String , default:null},
    state:{type:String , default:null},
    firstname:{type:String , default:null},
    lastname:{type:String , default:null},
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  }, { timestamps: true });

profileSchema.index({ userId: 1 })

export default mongoose.model('Profile',profileSchema)
