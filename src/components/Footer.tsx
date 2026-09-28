import { Link } from "react-router-dom";

const LINKS = {
  Product: ["Models", "Pricing", "Changelog", "Status"],
  Developers: ["Docs", "API Reference", "SDKs", "Examples"],
  Company: ["About", "Blog", "Careers", "Contact"],
  Legal: ["Privacy", "Terms", "Cookies"],
};

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="bg-primary-900/95 border-t border-secondary-800 text-secondary-400 font-sans">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-5">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1 flex flex-col gap-3">
            <Link
              to="/"
              className="flex items-center gap-1 font-extrabold text-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 rounded w-fit"
            >
              <span className="text-primary-400">DC-TIM</span>
            </Link>
            <p className="text-sm leading-relaxed">
              Next-generation policy analytics for everyone.
            </p>
          </div>

          {/* Link columns */}
          {Object.entries(LINKS).map(([group, items]) => (
            <div key={group} className="flex flex-col gap-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-secondary-500">
                {group}
              </p>
              <ul className="flex flex-col gap-2" role="list">
                {items.map((item) => (
                  <li key={item}>
                    <Link
                      to="#"
                      className="text-sm hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-400 rounded"
                    >
                      {item}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 border-t border-secondary-800 pt-6 text-xs text-secondary-600">
          © {year} DC-TIM. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
