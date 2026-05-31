/** @type {import('next').NextConfig} */
//
// Note: the legacy `api: { bodyParser: { sizeLimit: ... } }` option is a
// Pages Router config and Next 14 logs an "Unrecognized key" warning for it
// in the App Router. App Router Route Handlers accept any body size at the
// framework level — we rely on the `audio/upload` route's own size validation.
//
const nextConfig = {};

export default nextConfig;
