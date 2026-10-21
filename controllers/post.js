import {
  applyTagServ,
  deletePostServ,
  fetchArchiveServ,
  fetchFeedServ,
  fetchMyPostServ,
  fetchNotInterestedServ,
  fetchRelatedServ,
  fetchSavedPostsServ,
  finalSearchServ,
  notInterestedServ,
  removeNotInterestServ,
  searchTermsServ,
  servViewPost,
  setArchiveServ,
  toggleSaveServ,
  updatePostServ,
  uploadPostServ,
  withAuthorImages,
} from "../services/post.js";
import { FOLDERS, uploadImage } from "../services/imagekit.js";
import Post from "../schema/postSchema.js";
import { badRequest, forbidden, notFound } from "../utils/http.js";
import { cleanString, isHttpUrl, normalizeTags, parsePagination, requireObjectId } from "../utils/validation.js";

const isAdmin = (user) => user.role === "admin";
const isOwner = (post, user) => String(post.userId?._id ?? post.userId) === String(user._id);

const loadPost = async (id) => {
  const post = await Post.findById(requireObjectId(id, "post id"));
  if (!post) throw notFound("This post no longer exists");
  return post;
};

const loadOwnPost = async (id, user) => {
  const post = await loadPost(id);
  if (!isOwner(post, user)) throw forbidden("You can only change your own posts");
  return post;
};

// Validates the text fields shared by create and update.
const readPostFields = (body) => {
  const title = cleanString(body.title, 100);
  const description = cleanString(body.description, 1000);
  const url = cleanString(body.url, 2048);
  if (!title) throw badRequest("Title is required");
  if (!description) throw badRequest("Description is required");
  if (url && !isHttpUrl(url)) throw badRequest("Destination link must start with http:// or https://");
  return {
    postTitle: title,
    postDescription: description,
    url,
    location: cleanString(body.location, 100),
    tags: normalizeTags(body.tags),
  };
};

export const uploadPost = async (req, res) => {
  if (!req.file) throw badRequest("Please add an image");
  const fields = readPostFields(req.body);
  const image = await uploadImage(req.file, FOLDERS.posts);
  const post = await uploadPostServ({
    ...fields,
    userId: req.user._id,
    postImage: image.url,
    imageWidth: image.width,
    imageHeight: image.height,
  });
  res.status(201).json({ message: "Pin created", post });
};

export const fetchPost = async (req, res) => {
  const page = parsePagination(req.query);
  const { posts, hasMore } = await fetchFeedServ(req.user._id, page);
  res.status(200).json({ posts, page: page.page, hasMore });
};

export const viewPost = async (req, res) => {
  const post = await servViewPost(requireObjectId(req.params.id, "post id"));
  if (!post || !post.userId) throw notFound("This post no longer exists");

  // Only the owner or an admin can open archived, struck or blocked-author posts
  const hidden = post.archive || post.adminStrike || post.userId.adminblock;
  if (hidden && !isOwner(post, req.user) && !isAdmin(req.user)) throw notFound("This post is unavailable");

  res.status(200).json({ post: await withAuthorImages(post) });
};

export const relatedPosts = async (req, res) => {
  const post = await loadPost(req.params.id);
  res.status(200).json({ posts: await fetchRelatedServ(post, req.user._id) });
};

export const fetchMyPost = async (req, res) => {
  const authorId = requireObjectId(req.params.id, "user id");
  const posts = await fetchMyPostServ(authorId, { isOwner: authorId === String(req.user._id) });
  res.status(200).json({ posts });
};

export const deletePost = async (req, res) => {
  const post = await loadPost(req.body?.postId);
  if (!isOwner(post, req.user) && !isAdmin(req.user)) throw forbidden("You can only delete your own posts");
  await deletePostServ(post._id);
  res.status(200).json({ message: "Pin deleted" });
};

export const updatePost = async (req, res) => {
  const post = await loadOwnPost(req.params.postId, req.user);
  const update = readPostFields(req.body);

  if (req.file) {
    const image = await uploadImage(req.file, FOLDERS.posts);
    Object.assign(update, { postImage: image.url, imageWidth: image.width, imageHeight: image.height });
  }

  const updated = await updatePostServ(post._id, update);
  res.status(200).json({ message: "Pin updated", post: updated });
};

//save
export const pushSave = async (req, res) => {
  const post = await loadPost(req.body?.postId);
  const saved = await toggleSaveServ(post._id, req.user._id);
  res.status(200).json({ saved, message: saved ? "Saved to your profile" : "Removed from saved" });
};

export const fetchSavedPosts = async (req, res) => {
  const userId = requireObjectId(req.params.userId, "user id");
  if (userId !== String(req.user._id)) throw forbidden("Saved pins are private");
  res.status(200).json({ posts: await fetchSavedPostsServ(userId) });
};

//archive

export const fetchArchivePost = async (req, res) => {
  const userId = requireObjectId(req.params.userId, "user id");
  if (userId !== String(req.user._id)) throw forbidden("Archived pins are private");
  res.status(200).json({ posts: await fetchArchiveServ(userId) });
};

export const archivePost = async (req, res) => {
  const post = await loadOwnPost(req.body?.postId, req.user);
  await setArchiveServ(post._id, true);
  res.status(200).json({ message: "Pin archived" });
};

export const unArchivePost = async (req, res) => {
  const post = await loadOwnPost(req.body?.postId, req.user);
  await setArchiveServ(post._id, false);
  res.status(200).json({ message: "Pin restored" });
};

//search
const SEARCH_TYPES = ["Title", "Tag", "Location", "User"];

const readSearch = (source) => {
  const searchValue = cleanString(source.searchValue, 100);
  const select = SEARCH_TYPES.includes(source.select) ? source.select : "Title";
  return { searchValue, select };
};

export const searchTerms = async (req, res) => {
  const { searchValue, select } = readSearch(req.query);
  if (!searchValue) return res.status(200).json({ results: [] });
  res.status(200).json({ results: await searchTermsServ(searchValue, select, req.user._id) });
};

export const finalSearch = async (req, res) => {
  const { searchValue, select } = readSearch(req.body ?? {});
  if (!searchValue) return res.status(200).json({ posts: [], page: 1, hasMore: false });
  const page = parsePagination(req.body ?? {});
  const { posts, hasMore } = await finalSearchServ(searchValue, select, req.user._id, page);
  res.status(200).json({ posts, page: page.page, hasMore });
};

export const notInterested = async (req, res) => {
  const post = await loadPost(req.body?.postId);
  if (isOwner(post, req.user)) throw badRequest("You can't hide your own pin");
  await notInterestedServ(req.user._id, post._id);
  res.status(200).json({ message: "We'll show you fewer pins like this" });
};

export const fetchNotInterested = async (req, res) => {
  const userId = requireObjectId(req.params.id, "user id");
  if (userId !== String(req.user._id)) throw forbidden();
  res.status(200).json({ posts: await fetchNotInterestedServ(userId) });
};

export const removeNotInterest = async (req, res) => {
  const post = await loadPost(req.body?.postId);
  await removeNotInterestServ(post._id, req.user._id);
  res.status(200).json({ message: "Pin restored to your feed" });
};

export const applyTag = async (req, res) => {
  const value = cleanString(req.params.value, 50);
  res.status(200).json({ tags: value ? await applyTagServ(value) : [] });
};
