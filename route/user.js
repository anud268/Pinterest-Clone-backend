import express from "express";
import { blockedUsers, fetchIsblock, fetchProfilePic, fetchUser, logout, profilepic, removeOtp,  resendOtp,  setProfile, signin, signup, userBlock, userProfile } from "../controllers/user.js";
import { applyTag, archivePost, deletePost, fetchArchivePost, fetchMyPost, fetchNotInterested, fetchPost, fetchSavedPosts, finalSearch, notInterested, pushSave, removeNotInterest, searchTerms, unArchivePost, updatePost, uploadPost, viewPost } from "../controllers/post.js";
import { addCategory, adminblock, adminStrike, fetchActions, fetchAllPosts, fetchCards, fetchCat, fetchTagsFromCard, removeCards, setExplore, settags, userListAdmin } from "../controllers/admin.js";
const router = express.Router()
import dotenv from 'dotenv'
dotenv.config()

import upload from "../uploads/multer.js";



//users
router.post('/signup',signup)
router.post('/removeotp',removeOtp)
router.post('/resendotp',resendOtp)
router.post('/signin',signin)
router.post('/logout',logout)
router.get('/fetchuser',fetchUser)
router.post('/upload',upload.single('image'),uploadPost)
router.get('/profilepic/:id',fetchProfilePic)
router.get('/blockedusers/:id',blockedUsers)
router.post('/userblock',userBlock)
router.get('/isblock',fetchIsblock)
//posts
router.get('/posts/:id',fetchPost)
router.get('/viewpost/:id',viewPost)
router.post('/profilepic',upload.single('image'),profilepic)
router.post('/setprofile',setProfile)
router.get('/userprofile/:id',userProfile)
router.get('/myposts/:id',fetchMyPost)
router.post('/delete',deletePost)
router.post('/update/:postId',upload.single('image'),updatePost)
router.get('/applytag/:value',applyTag)
//actions
router.post('/save',pushSave)
router.get('/saved/:userId',fetchSavedPosts)
//archive
router.post('/archive',archivePost)
router.get('/archived/:userId',fetchArchivePost)
router.post('/unarchive',unArchivePost)
//search
router.get('/searchterms',searchTerms)
router.post('/finalsearch',finalSearch)
//not interested
router.post('/notinterested',notInterested)
router.get('/fetchnotinterested/:id',fetchNotInterested)
router.post('/removenotinterest',removeNotInterest)

//admin
router.get('/userlist',userListAdmin)
router.post('/adminblock',adminblock)
router.get('/allposts',fetchAllPosts)
router.post('/setexplore',upload.single('image'),setExplore)
router.get('/fetchcards',fetchCards)
router.post('/fetchtagsfromcard',fetchTagsFromCard)
router.post('/removecards',removeCards)
router.post('/addcategory',addCategory)
router.get('/fetchcat',fetchCat)
router.post('/settags',settags)
router.post('/adminstrike',adminStrike)
router.get('/fetchactions',fetchActions)

export default router