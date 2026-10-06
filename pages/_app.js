import Script from "next/script";
import Layout from "../components/Layout";
import "../styles/globals.css";
import "../styles/accessibility-and-account.css";

export default function App({ Component, pageProps }) {
  return (
    <>
      <Script
        src="https://js.paystack.co/v2/inline.js"
        strategy="afterInteractive"
        onReady={() => {
          if (typeof window !== "undefined") {
            window.__paystackInlineReady = true;
            window.dispatchEvent(new Event("paystack:inline-ready"));
          }
        }}
      />
      <Layout>
        <Component {...pageProps} />
      </Layout>
    </>
  );
}
