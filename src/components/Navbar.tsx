import { useState } from "react";
import { Link } from "react-router-dom";
import Button from "./Button";

const NAV_ITEMS = [
  { label: "Home",    to: "/"     },
  { label: "About",   to: "/#about"  },
  { label: "Contact", to: "/#contact" },
];

export default function Navbar() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 bg-primary-900/95 backdrop-blur border-b border-secondary-800">
      <nav
        className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8 h-16"
        aria-label="Main navigation"
      >
        {/* Logo */}
        <Link
          to="/"
          className="font-extrabold text-xl font-sans focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 rounded text-primary-400"
        >
          DC-TIM
        </Link>

        {/* Desktop links */}
        <ul className="hidden md:flex items-center gap-1" role="list">
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <Link
                to={item.to}
                className="px-3 py-2 rounded-lg text-sm font-medium font-sans text-secondary-300 hover:text-white hover:bg-secondary-800 transition-colors"
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>

        {/* Desktop CTA */}
        <div className="hidden md:flex items-center gap-3">
          <Link to="/login">
            <Button variant="ghost" size="sm">
              Sign in
            </Button>
          </Link>
          <Link to="/login">
            <Button variant="primary" size="sm">
              Get started
            </Button>
          </Link>
        </div>

        {/* Mobile hamburger */}
        <button
          className="md:hidden p-2 rounded-lg text-secondary-300 hover:text-white hover:bg-secondary-800 transition-colors"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? (
            <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </nav>

      {/* Mobile drawer */}
      {open && (
        <div className="md:hidden border-t border-secondary-800 bg-secondary-900 px-4 pb-4">
          <ul className="flex flex-col gap-1 pt-2" role="list">
            {NAV_ITEMS.map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  onClick={() => setOpen(false)}
                  className="block px-3 py-2 rounded-lg text-sm font-medium font-sans text-secondary-300 hover:text-white hover:bg-secondary-800 transition-colors"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-2 mt-4">
            <Link to="/login" onClick={() => setOpen(false)}>
              <Button variant="ghost" size="sm" fullWidth>Sign in</Button>
            </Link>
            <Link to="/login" onClick={() => setOpen(false)}>
              <Button variant="primary" size="sm" fullWidth>Get started</Button>
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
