/** @type {import('next').NextConfig} */
module.exports = {
  // Served under agnt.social/robinhood (proxied) and …vercel.app/robinhood.
  basePath: '/robinhood',
  turbopack: { root: __dirname },
  async headers() {
    // Open CORS on the API so AGNT builders can fork/extend it from anywhere.
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type' },
        ],
      },
    ];
  },
};
