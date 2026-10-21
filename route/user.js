import express from "express";
import { blockedUsers, fetchIsblock, fetchProfilePic, fetchUser, logout, profilepic, resendOtp, setProfile, signin, signup, userBlock, userProfile, verifyOtp } from "../controllers/user.js";
import { applyTag, archivePost, deletePost, fetchArchivePost, fetchMyPost, fetchNotInterested, fetchPost, fetchSavedPosts, finalSearch, notInterested, pushSave, relatedPosts, removeNotInterest, searchTerms, unArchivePost, updatePost, uploadPost, viewPost } from "../controllers/post.js";
import { addCategory, adminblock, adminStrike, fetchActions, fetchAllPosts, fetchCards, fetchCat, fetchTagsFromCard, removeCards, setExplore, settags, userListAdmin } from "../controllers/admin.js";
import { requireActive, requireAdmin, requireAuth } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import upload from "../middleware/multer.js";

const router = express.Router()

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 })
const signedIn = [requireAuth]
const canWrite = [requireAuth, requireActive]
const admin = [requireAuth, requireAdmin]

//auth
router.post('/signup', authLimiter, signup)
router.post('/verifyotp', authLimiter, verifyOtp)
router.post('/resendotp', authLimiter, resendOtp)
router.post('/signin', authLimiter, signin)
router.post('/logout', logout)
router.get('/fetchuser', signedIn, fetchUser)

//users
router.post('/upload', canWrite, upload.single('image'), uploadPost)
router.get('/profilepic/:id', signedIn, fetchProfilePic)
router.get('/blockedusers/:id', signedIn, blockedUsers)
router.post('/userblock', canWrite, userBlock)
router.get('/isblock', signedIn, fetchIsblock)
//posts
router.get('/posts', signedIn, fetchPost)
router.get('/viewpost/:id', signedIn, viewPost)
router.get('/related/:id', signedIn, relatedPosts)
router.post('/profilepic', canWrite, upload.single('image'), profilepic)
router.post('/setprofile', canWrite, setProfile)
router.get('/userprofile/:id', signedIn, userProfile)
router.get('/myposts/:id', signedIn, fetchMyPost)
router.post('/delete', signedIn, deletePost)
router.post('/update/:postId', canWrite, upload.single('image'), updatePost)
router.get('/applytag/:value', signedIn, applyTag)
//actions
router.post('/save', canWrite, pushSave)
router.get('/saved/:userId', signedIn, fetchSavedPosts)
//archive
router.post('/archive', signedIn, archivePost)
router.get('/archived/:userId', signedIn, fetchArchivePost)
router.post('/unarchive', signedIn, unArchivePost)
//search
router.get('/searchterms', signedIn, searchTerms)
router.post('/finalsearch', signedIn, finalSearch)
//not interested
router.post('/notinterested', signedIn, notInterested)
router.get('/fetchnotinterested/:id', signedIn, fetchNotInterested)
router.post('/removenotinterest', signedIn, removeNotInterest)
//explore
router.get('/fetchcards', signedIn, fetchCards)
router.post('/fetchtagsfromcard', signedIn, fetchTagsFromCard)

//admin
router.get('/userlist', admin, userListAdmin)
router.post('/adminblock', admin, adminblock)
router.get('/allposts', admin, fetchAllPosts)
router.post('/setexplore', admin, upload.single('image'), setExplore)
router.post('/removecards', admin, removeCards)
router.post('/addcategory', admin, addCategory)
router.get('/fetchcat', admin, fetchCat)
router.post('/settags', admin, settags)
router.post('/adminstrike', admin, adminStrike)
router.get('/fetchactions', admin, fetchActions)

export default router
