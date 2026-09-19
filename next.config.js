/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        // Applies to every route, including API routes.
        source: "/:path*",
        headers: [
          // Prevents the site (including /admin) from being framed by
          // another origin — a basic clickjacking defense.
          { key: "X-Frame-Options", value: "DENY" },
          // Stops browsers from MIME-sniffing responses into an
          // executable content type.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Don't leak the full referring URL (which can contain order
          // references or session-adjacent query params) to third-party
          // destinations.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Disable powerful browser features this app never uses.
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self)" },
          // Force HTTPS for a year, including subdomains, once you've
          // confirmed the whole site (and any subdomains you use) is
          // served over HTTPS. Remove/shorten this if you're not yet
          // fully committed to HTTPS-only.
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          // Report-Only: logs violations to the browser console instead of
          // blocking anything, so nothing on the live site can break from
          // this. Allows exactly what the app actually uses today —
          // Paystack's inline checkout script/iframe and Google Fonts —
          // plus 'unsafe-inline' for styles, since the app relies heavily
          // on inline style={{}} props throughout. Once you've browsed the
          // site for a few days with dev tools open and seen zero
          // "[Report Only]" violations in the console, rename this header
          // to "Content-Security-Policy" to actually start enforcing it.
          {
            key: "Content-Security-Policy-Report-Only",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' https://js.paystack.co",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: https:",
              "connect-src 'self' https://api.paystack.co https://checkout.paystack.com",
              "frame-src https://checkout.paystack.com https://js.paystack.co",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
