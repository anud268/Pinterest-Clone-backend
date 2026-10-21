import bcrypt from 'bcrypt'
import {
    blockedUsersServ,
    createOtpServ,
    fetchIsblockServ,
    fetchProfilePicServ,
    findUserByEmailServ,
    FindUserProfile,
    markEmailVerifiedServ,
    signupServ,
    toPublicUser,
    upsertProfileServ,
    userBlockServ,
    verifyOtpServ,
} from "../services/user.js"
import { sendOtpEmail } from '../services/mailer.js'
import { FOLDERS, uploadImage } from '../services/imagekit.js'
import { clearAuthCookie, setAuthCookie } from '../middleware/auth.js'
import User from '../schema/userSchema.js'
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../utils/http.js'
import { cleanString, requireObjectId } from '../utils/validation.js'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// The frontend historically posted `{ values: {...} }`; accept that or a flat body.
const formValues = (req) => req.body?.values ?? req.body ?? {}

const readEmail = (value) => {
    const email = cleanString(value, 254).toLowerCase()
    if (!EMAIL_PATTERN.test(email)) throw badRequest('Please enter a valid email address')
    return email
}

const sendNewOtp = async (email) => {
    const { code, ttlMinutes } = await createOtpServ(email)
    await sendOtpEmail(email, code, ttlMinutes)
}

const sessionUser = async (user) => toPublicUser(user, await FindUserProfile(user._id), { includeEmail: true })

export const signup = async (req, res) => {
    const values = formValues(req)
    const email = readEmail(values.email)
    const fullname = cleanString(values.fullname, 50)
    const password = typeof values.password === 'string' ? values.password : ''

    if (fullname.length < 3) throw badRequest('Username must be at least 3 characters')
    if (password.length < 6) throw badRequest('Password must be at least 6 characters')

    const existing = await findUserByEmailServ(email)
    if (existing) {
        if (existing.emailVerified !== false) throw conflict('An account with this email already exists. Please sign in.')
        // Unverified account: send a new code so the person can finish signing up
        await sendNewOtp(existing.email)
        return res.status(200).json({ needsVerification: true, email: existing.email, message: 'We sent you a new verification code' })
    }

    await signupServ({ email, fullname, password })
    await sendNewOtp(email)
    res.status(201).json({ needsVerification: true, email, message: 'Check your email for a verification code' })
}

export const verifyOtp = async (req, res) => {
    const email = readEmail(req.body?.email)
    const otp = cleanString(String(req.body?.otp ?? ''), 6)
    if (!/^\d{6}$/.test(otp)) throw badRequest('Enter the 6-digit code from your email')

    const user = await findUserByEmailServ(email)
    if (!user) throw badRequest('This code has expired. Please request a new one.')

    await verifyOtpServ(user.email, otp)
    const verified = user.emailVerified === false ? await markEmailVerifiedServ(user._id) : user
    setAuthCookie(res, verified)
    res.status(200).json({ user: await sessionUser(verified) })
}

export const resendOtp = async (req, res) => {
    const email = readEmail(req.body?.email)
    const user = await findUserByEmailServ(email)
    // Same response either way so this endpoint can't be used to discover accounts
    if (user && user.emailVerified === false) await sendNewOtp(user.email)
    res.status(200).json({ message: 'If that account needs verification, a new code is on its way' })
}

export const signin = async (req, res) => {
    const values = formValues(req)
    const email = readEmail(values.email)
    const password = typeof values.password === 'string' ? values.password : ''
    if (!password) throw badRequest('Please enter your password')

    const user = await findUserByEmailServ(email, { withPassword: true })
    const isMatch = user ? await bcrypt.compare(password, user.password) : false
    if (!isMatch) throw unauthorized('Incorrect email or password')

    if (user.emailVerified === false) {
        await sendNewOtp(user.email)
        return res.status(403).json({ needsVerification: true, email: user.email, message: 'Please verify your email. We sent you a new code.' })
    }

    setAuthCookie(res, user)
    res.status(200).json({ user: await sessionUser(user) })
}

export const logout = (req, res) => {
    clearAuthCookie(res)
    res.status(200).json({ message: 'Signed out' })
}

export const fetchUser = async (req, res) => {
    res.status(200).json({ user: await sessionUser(req.user) })
}

//profile

export const profilepic = async (req, res) => {
    if (!req.file) throw badRequest('Please choose an image to upload')
    const { url } = await uploadImage(req.file, FOLDERS.profile)
    const profile = await upsertProfileServ(req.user._id, { image: url })
    res.status(200).json({ profile })
}

export const setProfile = async (req, res) => {
    const values = formValues(req)
    const fields = {}
    for (const [key, max] of [['firstname', 50], ['lastname', 50], ['bio', 300], ['country', 60], ['state', 60]]) {
        if (values[key] !== undefined) fields[key] = cleanString(values[key], max) || null
    }
    const profile = await upsertProfileServ(req.user._id, fields)
    res.status(200).json({ profile })
}

export const userProfile = async (req, res) => {
    const userId = requireObjectId(req.params.id, 'user id')
    const user = await User.findById(userId)
    if (!user) throw notFound('This profile does not exist')

    const isSelf = String(user._id) === String(req.user._id)
    const isAdmin = req.user.role === 'admin'
    if (user.adminblock && !isSelf && !isAdmin) throw notFound('This profile is unavailable')

    const profile = await FindUserProfile(userId)
    res.status(200).json({
        profile: {
            ...toPublicUser(user, profile, { includeEmail: isSelf || isAdmin }),
            userId: user._id,
            firstname: profile?.firstname || null,
            lastname: profile?.lastname || null,
            bio: profile?.bio || null,
            country: profile?.country || null,
            state: profile?.state || null,
        },
    })
}

export const fetchProfilePic = async (req, res) => {
    const userId = requireObjectId(req.params.id, 'user id')
    res.status(200).json({ image: await fetchProfilePicServ(userId) })
}

export const userBlock = async (req, res) => {
    const targetId = requireObjectId(req.body?.id, 'user id')
    if (targetId === String(req.user._id)) throw badRequest("You can't block yourself")
    if (!(await User.exists({ _id: targetId }))) throw notFound('User not found')

    const blocked = await userBlockServ(targetId, String(req.user._id))
    res.status(200).json({ blocked, message: blocked ? 'User blocked' : 'User unblocked' })
}

export const fetchIsblock = async (req, res) => {
    const targetId = requireObjectId(req.query.userId, 'user id')
    res.status(200).json({ blocked: await fetchIsblockServ(targetId, String(req.user._id)) })
}

export const blockedUsers = async (req, res) => {
    const userId = requireObjectId(req.params.id, 'user id')
    if (userId !== String(req.user._id)) throw forbidden()
    res.status(200).json({ users: await blockedUsersServ(userId) })
}
