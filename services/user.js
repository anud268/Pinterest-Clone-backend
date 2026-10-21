import bcrypt from 'bcrypt'
import crypto from 'crypto'
import User from '../schema/userSchema.js'
import Otp, { OTP_TTL_SECONDS } from '../schema/otpSchema.js'
import Profile from '../schema/profileSchema.js'
import { badRequest, HttpError } from '../utils/http.js'
import { escapeRegex } from '../utils/validation.js'

const MAX_OTP_ATTEMPTS = 5

// Shape of a user as sent to the browser. Email is only included for the user themself or admins.
export const toPublicUser = (user, profile, { includeEmail = false } = {}) => ({
    _id: user._id,
    fullname: user.fullname,
    role: user.role || 'user',
    adminblock: Boolean(user.adminblock),
    image: profile?.image || null,
    createdAt: user.createdAt,
    ...(includeEmail ? { email: user.email } : {}),
})

export const findUserByEmailServ = (email, { withPassword = false } = {}) => {
    // Case-insensitive so accounts created before emails were lower-cased still match
    const query = User.findOne({ email: new RegExp(`^${escapeRegex(email)}$`, 'i') })
    return withPassword ? query.select('+password') : query
}

export const signupServ = async ({ email, fullname, password }) => {
    const hashedPassword = await bcrypt.hash(password, 10)
    return User.create({ email, fullname, password: hashedPassword, emailVerified: false })
}

// Creates a fresh code for `email` (replacing older ones) and returns the plain code.
export const createOtpServ = async (email) => {
    const code = crypto.randomInt(100000, 1000000).toString()
    await Otp.deleteMany({ email })
    await Otp.create({ email, otp: await bcrypt.hash(code, 8) })
    return { code, ttlMinutes: OTP_TTL_SECONDS / 60 }
}

export const verifyOtpServ = async (email, code) => {
    const otp = await Otp.findOne({ email }).sort({ createdAt: -1 })
    const expired = !otp || Date.now() - otp.createdAt.getTime() > OTP_TTL_SECONDS * 1000
    if (expired) throw badRequest('This code has expired. Please request a new one.')
    if (otp.attempts >= MAX_OTP_ATTEMPTS) {
        await Otp.deleteMany({ email })
        throw new HttpError(429, 'Too many incorrect attempts. Please request a new code.')
    }

    const matches = await bcrypt.compare(String(code), otp.otp)
    if (!matches) {
        await Otp.updateOne({ _id: otp._id }, { $inc: { attempts: 1 } })
        throw badRequest('That code is incorrect. Please check your email and try again.')
    }
    await Otp.deleteMany({ email })
}

export const markEmailVerifiedServ = (userId) =>
    User.findByIdAndUpdate(userId, { emailVerified: true }, { new: true })

// profile

export const FindUserProfile = (userId) => Profile.findOne({ userId })

export const upsertProfileServ = (userId, fields) =>
    Profile.findOneAndUpdate({ userId }, { $set: fields, $setOnInsert: { userId } }, { new: true, upsert: true })

export const fetchProfilePicServ = async (userId) => {
    const profile = await Profile.findOne({ userId }, 'image')
    return profile?.image || null
}

// Map of userId -> profile image for a list of user ids
export const profileImagesServ = async (userIds) => {
    const profiles = await Profile.find({ userId: { $in: userIds } }, 'userId image').lean()
    return new Map(profiles.map((p) => [String(p.userId), p.image]))
}

// block (`userblock` on a user lists the ids of the people who blocked them)

export const userBlockServ = async (targetId, viewerId) => {
    const alreadyBlocked = await User.exists({ _id: targetId, userblock: viewerId })
    const update = alreadyBlocked ? { $pull: { userblock: viewerId } } : { $addToSet: { userblock: viewerId } }
    await User.updateOne({ _id: targetId }, update)
    return !alreadyBlocked
}

export const fetchIsblockServ = async (targetId, viewerId) =>
    Boolean(await User.exists({ _id: targetId, userblock: viewerId }))

export const blockedUsersServ = async (viewerId) => {
    const users = await User.find({ userblock: viewerId }).sort({ updatedAt: -1 })
    const images = await profileImagesServ(users.map((u) => u._id))
    return users.map((u) => toPublicUser(u, { image: images.get(String(u._id)) }))
}
