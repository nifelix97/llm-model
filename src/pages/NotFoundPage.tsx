import { Link } from "react-router-dom";
import Button from "../components/Button";
import PublicLayout from "../components/PublicLayout";

export default function NotFoundPage() {
  return (
    <PublicLayout>
      <div className="flex-1 flex items-center justify-center px-4 py-24">
        <div className="flex flex-col items-center gap-6 text-center max-w-lg">
          <p className="text-8xl font-extrabold text-primary-400 font-sans leading-none">
            404
          </p>

          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-bold text-white font-sans">
              Page not found
            </h1>
            <p className="text-secondary-400 font-sans">
              The page you're looking for doesn't exist or has been moved.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link to="/">
              <Button size="md">Back to home</Button>
            </Link>
            <Link to="/dashboard">
              <Button variant="ghost" size="md" className="border-secondary-600 text-secondary-300 hover:bg-secondary-800">
                Open Dashboard
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}
