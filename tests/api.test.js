import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { createClient, pngFile, startApi, startImageStub } from './helpers.js';

let api;
let stub;
let db;

const alice = { email: 'alice@example.com', fullname: 'Alice Doe', password: 'secret123' };
const bob = { email: 'bob@example.com', fullname: 'Bob Roe', password: 'secret456' };

const signUpAndVerify = async (client, values) => {
  const signup = await client.post('/signup', { values });
  assert.equal(signup.status, 201);
  const verify = await client.post('/verifyotp', { email: values.email, otp: api.otpFor(values.email) });
  assert.equal(verify.status, 200);
  return verify.data.user;
};

const createPost = async (client, fields = {}) => {
  const form = new FormData();
  form.append('image', pngFile(), 'pin.png');
  form.append('title', fields.title ?? 'Sunset');
  form.append('description', fields.description ?? 'Golden hour');
  for (const tag of fields.tags ?? ['#Nature']) form.append('tags', tag);
  const res = await client.post('/upload', undefined, { form });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return res.data.post;
};

const feedIds = async (client) => (await client.get('/posts')).data.posts.map((p) => p._id);

before(async () => {
  stub = await startImageStub();
  api = await startApi({ port: 3611, imageUploadUrl: stub.url });
  db = await mongoose.createConnection(api.mongoUri).asPromise();
});

after(async () => {
  await db?.close();
  await api?.stop();
  stub?.server.close();
});

describe('authentication', () => {
  test('protected routes reject anonymous requests', async () => {
    const client = createClient(api.baseUrl);
    for (const url of ['/posts', '/fetchuser', '/userlist', '/fetchcards']) {
      assert.equal((await client.get(url)).status, 401, url);
    }
    assert.equal((await client.post('/delete', { postId: '0'.repeat(24) })).status, 401);
  });

  test('signup validates input', async () => {
    const client = createClient(api.baseUrl);
    assert.equal((await client.post('/signup', { values: { ...alice, email: 'nope' } })).status, 400);
    assert.equal((await client.post('/signup', { values: { ...alice, password: '123' } })).status, 400);
  });

  test('signup requires a server-verified OTP before a session is issued', async () => {
    const client = createClient(api.baseUrl);
    const signup = await client.post('/signup', { values: alice });
    assert.equal(signup.status, 201);
    assert.equal(signup.data.needsVerification, true);
    assert.equal(signup.data.setOtp, undefined, 'OTP must never be sent to the client');
    assert.equal(client.hasCookie(), false);

    const early = await client.post('/signin', { values: alice });
    assert.equal(early.status, 403);
    assert.equal(early.data.needsVerification, true);

    assert.equal((await client.post('/verifyotp', { email: alice.email, otp: '000000' })).status, 400);

    const verify = await client.post('/verifyotp', { email: alice.email, otp: api.otpFor(alice.email) });
    assert.equal(verify.status, 200);
    assert.equal(verify.data.user.fullname, alice.fullname);
    assert.equal(verify.data.user.password, undefined);

    const me = await client.get('/fetchuser');
    assert.equal(me.status, 200);
    assert.equal(me.data.user.email, alice.email);
    assert.equal(me.data.user.password, undefined);
  });

  test('duplicate signup is rejected and wrong passwords fail generically', async () => {
    const client = createClient(api.baseUrl);
    assert.equal((await client.post('/signup', { values: alice })).status, 409);
    const wrong = await client.post('/signin', { values: { email: alice.email, password: 'wrong-pass' } });
    assert.equal(wrong.status, 401);
    const unknown = await client.post('/signin', { values: { email: 'ghost@example.com', password: 'whatever' } });
    assert.equal(unknown.status, 401);
    assert.equal(wrong.data.message, unknown.data.message);
  });

  test('signin is case-insensitive on email and logout ends the session', async () => {
    const client = createClient(api.baseUrl);
    const res = await client.post('/signin', { values: { email: 'ALICE@example.com', password: alice.password } });
    assert.equal(res.status, 200);
    assert.equal((await client.get('/fetchuser')).status, 200);
    await client.post('/logout');
    assert.equal((await client.get('/fetchuser')).status, 401);
  });

  test('legacy accounts without emailVerified can still sign in', async () => {
    const client = createClient(api.baseUrl);
    await signUpAndVerify(client, { email: 'legacy@example.com', fullname: 'Legacy User', password: 'secret789' });
    await db.collection('users').updateOne({ email: 'legacy@example.com' }, { $unset: { emailVerified: '' } });
    const res = await client.post('/signin', { values: { email: 'legacy@example.com', password: 'secret789' } });
    assert.equal(res.status, 200);
  });
});

describe('posts', () => {
  let a;
  let b;
  let aliceId;
  let alicePost;

  before(async () => {
    a = createClient(api.baseUrl);
    b = createClient(api.baseUrl);
    aliceId = (await a.post('/signin', { values: alice })).data.user._id;
    await signUpAndVerify(b, bob);
    alicePost = await createPost(a, { tags: ['#Nature', '#Sky'] });
  });

  test('upload validates the image and fields', async () => {
    const noFile = new FormData();
    noFile.append('title', 'x');
    noFile.append('description', 'y');
    assert.equal((await a.post('/upload', undefined, { form: noFile })).status, 400);

    const wrongType = new FormData();
    wrongType.append('image', new Blob(['hello'], { type: 'text/plain' }), 'a.txt');
    wrongType.append('title', 'x');
    wrongType.append('description', 'y');
    assert.equal((await a.post('/upload', undefined, { form: wrongType })).status, 400);

    const tooBig = new FormData();
    tooBig.append('image', new Blob([Buffer.alloc(6 * 1024 * 1024)], { type: 'image/png' }), 'big.png');
    tooBig.append('title', 'x');
    tooBig.append('description', 'y');
    assert.equal((await a.post('/upload', undefined, { form: tooBig })).status, 413);

    assert.equal(alicePost.imageWidth, 800);
    assert.deepEqual(alicePost.tags, ['#Nature', '#Sky']);
    assert.equal(alicePost.userId, aliceId, 'owner comes from the session, not the request');
  });

  test('feed is paginated and includes author details', async () => {
    const res = await b.get('/posts?limit=1');
    assert.equal(res.status, 200);
    assert.equal(res.data.posts.length, 1);
    assert.equal(res.data.page, 1);
    assert.equal(typeof res.data.hasMore, 'boolean');
    const post = (await b.get('/posts')).data.posts.find((p) => p._id === alicePost._id);
    assert.equal(post.userId.fullname, alice.fullname);
    assert.equal(post.userId.email, undefined);
  });

  test('legacy posts with messy tags and missing flags are shown with clean tags', async () => {
    const { insertedId } = await db.collection('posts').insertOne({
      postTitle: 'Legacy',
      postImage: 'https://example.com/a.jpg',
      tags: ['["#Old","#Style"]', '#Trend,#Look'],
      saved: [],
      interested: [],
      userId: new mongoose.Types.ObjectId(aliceId),
      createdAt: new Date(),
    });
    const res = await b.get(`/viewpost/${insertedId}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.data.post.tags, ['#Old', '#Style', '#Trend', '#Look']);
    assert.ok((await feedIds(b)).includes(String(insertedId)));
  });

  test('only the owner can edit, archive or delete a post', async () => {
    const form = new FormData();
    form.append('title', 'Hacked');
    form.append('description', 'Hacked');
    assert.equal((await b.post(`/update/${alicePost._id}`, undefined, { form })).status, 403);
    assert.equal((await b.post('/archive', { postId: alicePost._id })).status, 403);
    assert.equal((await b.post('/delete', { postId: alicePost._id })).status, 403);

    const ownForm = new FormData();
    ownForm.append('title', 'Sunset, edited');
    ownForm.append('description', 'Still golden');
    ownForm.append('tags', '#Nature');
    const updated = await a.post(`/update/${alicePost._id}`, undefined, { form: ownForm });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.post.postTitle, 'Sunset, edited');
  });

  test('archive hides a post from others until it is restored', async () => {
    assert.equal((await a.post('/archive', { postId: alicePost._id })).status, 200);
    assert.ok(!(await feedIds(b)).includes(alicePost._id));
    assert.equal((await b.get(`/viewpost/${alicePost._id}`)).status, 404);
    assert.equal((await a.get(`/viewpost/${alicePost._id}`)).status, 200);
    assert.equal((await a.get(`/archived/${aliceId}`)).data.posts.length, 1);
    assert.equal((await b.get(`/archived/${aliceId}`)).status, 403);
    assert.equal((await a.post('/unarchive', { postId: alicePost._id })).status, 200);
    assert.ok((await feedIds(b)).includes(alicePost._id));
  });

  test('save toggles and saved lists are private', async () => {
    const bobId = (await b.get('/fetchuser')).data.user._id;
    assert.equal((await b.post('/save', { postId: alicePost._id })).data.saved, true);
    assert.equal((await b.get(`/saved/${bobId}`)).data.posts.length, 1);
    assert.equal((await a.get(`/saved/${bobId}`)).status, 403);
    assert.equal((await b.post('/save', { postId: alicePost._id })).data.saved, false);
    assert.equal((await b.get(`/saved/${bobId}`)).data.posts.length, 0);
  });

  test('not interested hides a post for that viewer only', async () => {
    const bobId = (await b.get('/fetchuser')).data.user._id;
    await b.post('/notinterested', { postId: alicePost._id });
    assert.ok(!(await feedIds(b)).includes(alicePost._id));
    assert.equal((await b.get(`/fetchnotinterested/${bobId}`)).data.posts.length, 1);
    assert.equal((await a.post('/notinterested', { postId: alicePost._id })).status, 400);
    await b.post('/removenotinterest', { postId: alicePost._id });
    assert.ok((await feedIds(b)).includes(alicePost._id));
  });

  test('blocking a user hides their posts and is reversible', async () => {
    const bobId = (await b.get('/fetchuser')).data.user._id;
    assert.equal((await b.post('/userblock', { id: aliceId })).data.blocked, true);
    assert.equal((await b.get(`/isblock?userId=${aliceId}`)).data.blocked, true);
    assert.ok(!(await feedIds(b)).includes(alicePost._id));
    assert.deepEqual((await b.get(`/blockedusers/${bobId}`)).data.users.map((u) => u._id), [aliceId]);
    assert.equal((await b.post('/userblock', { id: bobId })).status, 400);
    assert.equal((await b.post('/userblock', { id: aliceId })).data.blocked, false);
    assert.ok((await feedIds(b)).includes(alicePost._id));
  });

  test('profiles can be updated and read', async () => {
    const res = await a.post('/setprofile', { values: { firstname: 'Alice', bio: 'Hello there' } });
    assert.equal(res.status, 200);
    const profile = (await b.get(`/userprofile/${aliceId}`)).data.profile;
    assert.equal(profile.firstname, 'Alice');
    assert.equal(profile.fullname, alice.fullname);
    assert.equal(profile.email, undefined);
    assert.equal((await b.get('/userprofile/not-an-id')).status, 400);
  });

  test('search escapes user input and returns visible posts', async () => {
    assert.equal((await b.get('/searchterms?searchValue=(%5B&select=Title')).status, 200);
    const suggestions = await b.get('/searchterms?searchValue=sun&select=Title');
    assert.deepEqual(suggestions.data.results, ['Sunset, edited']);
    const tags = await b.get('/searchterms?searchValue=sty&select=Tag');
    assert.deepEqual(tags.data.results, ['#Style']);
    const users = await b.get('/searchterms?searchValue=ali&select=User');
    assert.equal(users.data.results[0].fullname, alice.fullname);
    const results = await b.post('/finalsearch', { searchValue: 'sunset', select: 'Title' });
    assert.deepEqual(results.data.posts.map((p) => p._id), [alicePost._id]);
  });

  test('related posts share tags with the current post', async () => {
    const other = await createPost(a, { title: 'Forest', tags: ['#Nature'] });
    await createPost(a, { title: 'Car', tags: ['#Cars'] });
    const related = await b.get(`/related/${alicePost._id}`);
    assert.equal(related.status, 200);
    const ids = related.data.posts.map((p) => p._id);
    assert.ok(ids.includes(other._id));
    assert.ok(!ids.includes(alicePost._id));
  });

  test('admin endpoints require the admin role', async () => {
    assert.equal((await b.get('/userlist')).status, 403);
    assert.equal((await b.post('/adminstrike', { postId: alicePost._id })).status, 403);

    await db.collection('users').updateOne({ email: bob.email }, { $set: { role: 'admin' } });
    const users = await b.get('/userlist');
    assert.equal(users.status, 200);
    assert.ok(users.data.users.every((u) => u.password === undefined));

    assert.equal((await b.post('/adminstrike', { postId: alicePost._id })).data.striked, true);
    const c = createClient(api.baseUrl);
    await signUpAndVerify(c, { email: 'carol@example.com', fullname: 'Carol Poe', password: 'secret000' });
    assert.ok(!(await feedIds(c)).includes(alicePost._id));
    assert.equal((await c.get(`/viewpost/${alicePost._id}`)).status, 404);
    assert.ok((await a.get(`/myposts/${aliceId}`)).data.posts.some((p) => p._id === alicePost._id));
    assert.equal((await b.post('/adminstrike', { postId: alicePost._id })).data.striked, false);

    assert.equal((await b.post('/addcategory', { values: { category: 'Nature' } })).status, 201);
    assert.equal((await b.post('/addcategory', { values: { category: 'Nature' } })).status, 409);
    const categoryId = (await b.get('/fetchcat')).data.categories[0]._id;
    assert.equal((await b.post('/settags', { tag: 'no hash', category: categoryId })).status, 400);
    assert.equal((await b.post('/settags', { tag: '#Nature', category: categoryId })).status, 200);
    const byCategory = await c.post('/fetchtagsfromcard', { cat: 'Nature' });
    assert.ok(byCategory.data.posts.length >= 2);
  });

  test('admin-blocked users become read-only', async () => {
    await b.post('/adminblock', { id: aliceId });
    const form = new FormData();
    form.append('image', pngFile(), 'pin.png');
    form.append('title', 'Blocked');
    form.append('description', 'Should fail');
    assert.equal((await a.post('/upload', undefined, { form })).status, 403);
    assert.equal((await a.post('/save', { postId: alicePost._id })).status, 403);
    assert.equal((await a.get('/posts')).status, 200);
    await b.post('/adminblock', { id: aliceId });
  });

  test('invalid ids return 400 instead of crashing', async () => {
    assert.equal((await a.get('/viewpost/123')).status, 400);
    assert.equal((await a.post('/save', { postId: { $gt: '' } })).status, 400);
    assert.equal((await a.get(`/viewpost/${'a'.repeat(24)}`)).status, 404);
  });
});
