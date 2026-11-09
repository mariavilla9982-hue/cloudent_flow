const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

const accountId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const postId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const otherAccountId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const secondAccount = { id: otherAccountId, enabled: true, config: { status: 'connected', username: 'SecondTest' } };
const env = {
  SUPABASE_URL: 'https://cloudent.test',
  CLOUDENT_X_BUFFER_CHANNELS: JSON.stringify({ [accountId]: 'buffer-channel' }),
  CLOUDENT_X_BUFFER_API_KEY: 'test-key',
};
const context = vm.createContext({
  URL, Request, Response, Headers, AbortSignal, TextEncoder, TextDecoder,
  Deno: { env: { get: key => env[key] }, serve() {} },
  twitterText: {
    parseTweet: text => ({ valid: text.length > 0 }),
    extractUrlsWithIndices: text => Array.from(text.matchAll(/https:\/\/[^\s]+/g), match => ({
      url: match[0], indices: [match.index, match.index + match[0].length],
    })),
  },
});
const worker = fs.readFileSync('supabase/functions/cloudent-x-publish-worker/index.ts', 'utf8');
vm.runInContext(stripTypeScriptTypes(worker).replace(/^import .*;\n/gm, ''), context);
const config = { platform_account_id: accountId };
const account = { id: accountId, enabled: true, config: { status: 'connected', username: 'ReisTest' } };
const file = {
  id: postId, user_id: 'test-user', platform_account_id: accountId,
  status: 'queued', post_text: 'Caption', reply_text: 'Link https://example.test/dest',
  meta: { source: 'upload', storage_provider: 'r2', storage_path: 'test-user/x-uploads/file.mp4' },
};
const files = [file];
const remotePosts = new Map();
let paidCalls = 0;
let creates = 0;
let connection = 'reistest';
let remoteState = 'buffer';
let registeredAccount;
const updates = [];
const admin = {
  from(table) {
    const filters = {};
    let patch;
    const query = {
      select: () => query,
      insert: async () => ({}),
      update: fields => { patch = fields; return query; },
      eq: (key, value) => { filters[key] = value; return query; },
      is: (key, value) => query.eq(key, value),
      maybeSingle: async () => ({ data: await query.then(value => value.data[0] ?? null) }),
      then(done) {
        if (table !== 'x_drive_posts') return Promise.resolve(done({ data: [] }));
        const matches = files.filter(row => Object.entries(filters).every(([key, value]) => row[key] === value));
        if (patch) for (const row of matches) Object.assign(row, structuredClone(patch));
        return Promise.resolve(done({ data: structuredClone(matches) }));
      },
    };
    return query;
  },
  async rpc(name, args) {
    if (name === 'claim_x_account_post') {
      const row = files.find(row => row.platform_account_id === args.p_account && row.status === 'queued');
      if (!row) return { data: null };
      Object.assign(row, { status: 'processing', locked_by: args.p_worker, attempts: 1 });
      return { data: structuredClone(row) };
    }
    if (name === 'complete_x_upload_post') {
      const row = files.find(row => row.id === args.p_id);
      assert.equal(row.locked_by, args.p_worker_id);
      assert.equal(row.platform_account_id, args.p_account_id);
      assert.equal(args.p_post_id, remotePosts.get(row.meta.buffer_post_id).postId);
      Object.assign(row, { status: 'published', x_post_id: args.p_post_id, reply_status: 'pending' });
      return {};
    }
    if (name === 'x_buffer_follow_link') {
      updates.push(args.p_count);
      return { data: args.p_post_id === postId ? file.meta.buffer_click_target : null };
    }
    if (name === 'x_buffer_register_account') {
      registeredAccount = args;
      return { data: args.p_id };
    }
    throw new Error('Unexpected RPC ' + name);
  },
};
context.resolveXAccount = async (_admin, _user, { platform_account_id }) => platform_account_id === otherAccountId ? secondAccount : account;
context.uploadReadUrl = async () => 'https://storage.test/video.mp4?signature=abc';
const originalXToken = context.usableXToken;
context.usableXToken = async () => { paidCalls++; throw Error('Paid X call'); };
context.fetch = async (url, options) => {
  assert.equal(url, 'https://api.buffer.com');
  const { query, variables } = JSON.parse(options.body);
  if (query.startsWith('query Channel')) {
    return Response.json({ data: { channel: { service: 'twitter', serviceId: '42', name: variables.id === 'second-channel' ? 'secondtest' : connection } } });
  }
  if (query.startsWith('mutation Send')) {
    creates++;
    assert.equal(variables.input.mode, 'shareNow');
    const [root, reply] = variables.input.metadata.twitter.thread;
    assert.equal(root.assets[0].video.url, 'https://storage.test/video.mp4?signature=abc');
    const prefix = 'Link https://cloudent.test/functions/v1/cloudent-x-publish-worker?action=link&id=';
    assert.ok(reply.text.startsWith(prefix));
    const row = files.find(row => row.id === reply.text.slice(prefix.length));
    assert.equal(variables.input.channelId, row.platform_account_id === accountId ? 'buffer-channel' : 'second-channel');
    assert.equal(root.text, row.post_text);
    assert.equal([...remotePosts.values()].some(remote => remote.rowId === row.id), false, 'one Buffer send per post');
    const id = 'buffer-post-' + creates;
    remotePosts.set(id, { rowId: row.id, postId: String(12344 + creates), handle: row.platform_account_id === accountId ? 'ReisTest' : 'SecondTest' });
    return Response.json({ data: { createPost: { post: { id } } } });
  }
  if (query.startsWith('query Status')) {
    const remote = remotePosts.get(variables.id);
    return Response.json({ data: { post: { id: variables.id, status: remoteState, externalLink: `https://x.com/${remote.handle}/status/${remote.postId}` } } });
  }
  throw new Error('Unexpected Buffer operation');
};

(async () => {
  assert.equal(context.bufferChannelFor(otherAccountId), '');
  const registration = { account_id: accountId, owner_user_id: otherAccountId, username: '@ReisTest' };
  assert.equal((await context.registerBufferAccount(admin, registration)).account_id, accountId);
  assert.equal(registeredAccount.p_x_user_id, '42');
  await assert.rejects(context.registerBufferAccount(admin, { ...registration, username: 'wrong' }), /outra conta X/);
  const run = () => context.publishOne(admin, file.user_id, config, '', 'worker');
  assert.equal((await run()).state, 'buffer_processing');
  assert.equal(file.meta.buffer_post_id, 'buffer-post-1');
  assert.equal((await run()).state, 'buffer_processing');
  assert.equal(creates, 1);
  remoteState = 'sent';
  assert.equal((await run()).state, 'published');
  assert.equal(file.reply_status, 'published');
  await context.publishReply(admin, { ...file, reply_status: 'pending' }, '');
  assert.equal(paidCalls, 0);
  assert.equal(await run(), null);
  const tracked = new URL('https://cloudent.test/?action=link&id=' + postId);
  assert.equal((await context.followBufferLink(admin, new Request(tracked, { headers: { 'User-Agent': 'Firefox' } }), tracked)).headers.get('location'), 'https://example.test/dest');
  await context.followBufferLink(admin, new Request(tracked, { headers: { 'User-Agent': 'Twitterbot' } }), tracked);
  await context.followBufferLink(admin, new Request(tracked, { method: 'HEAD' }), tracked);
  assert.deepEqual(updates, [true, false, false]);
  Object.assign(file, { status: 'queued', x_post_id: null });
  connection = 'wrong_handle';
  assert.equal((await run()).state, 'failed');
  assert.equal(creates, 1);
  connection = 'reistest';
  env.CLOUDENT_X_BUFFER_CHANNELS = JSON.stringify({ [accountId]: 'buffer-channel', [otherAccountId]: 'second-channel' });
  const runSecond = () => context.publishOne(admin, file.user_id, { platform_account_id: otherAccountId }, '', 'worker');
  const batch = [accountId, otherAccountId].flatMap((platform_account_id, accountIndex) =>
    Array.from({ length: 6 }, (_, slot) => ({
      ...structuredClone(file),
      id: `dddddddd-dddd-4ddd-8ddd-${String(accountIndex * 6 + slot).padStart(12, '0')}`,
      platform_account_id,
      status: 'queued',
      x_post_id: null,
      post_text: `Account ${accountIndex + 1}, slot ${slot + 1}`,
      meta: { source: 'upload', storage_provider: 'r2', storage_path: 'test-user/x-uploads/file.mp4' },
    }))
  );
  files.push(...batch);
  for (let slot = 0; slot < 6; slot++) {
    remoteState = 'buffer';
    assert.equal((await run()).id, batch[slot].id);
    assert.equal((await runSecond()).id, batch[6 + slot].id);
    assert.equal((await run()).state, 'buffer_processing');
    assert.equal((await runSecond()).state, 'buffer_processing');
    remoteState = 'sent';
    assert.equal((await run()).state, 'published');
    assert.equal((await runSecond()).state, 'published');
  }
  assert.ok(batch.every(row => row.status === 'published' && row.reply_status === 'published'));
  assert.equal(creates, 13);
  assert.equal(await run(), null);
  assert.equal(await runSecond(), null);
  delete env.CLOUDENT_X_BUFFER_API_KEY;
  await assert.rejects(run, /Conecte o Buffer/);
  delete env.CLOUDENT_X_BUFFER_CHANNELS;
  const bufferOnly = { ...account, config: { ...account.config, publish_provider: 'buffer' } };
  await assert.rejects(originalXToken(admin, bufferOnly, ''), /exclusivamente pelo Buffer/);
  assert.equal((await context.syncAccountMetrics(admin, bufferOnly, '')).ok, true);
  assert.equal(paidCalls, 0);
  console.log('PASS six videos and six replies on each of two accounts, isolated queues, no duplicate or paid X fallback, and tracked redirects');
})().catch(error => { console.error(error); process.exitCode = 1; });
