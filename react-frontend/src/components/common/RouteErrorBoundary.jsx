import React from 'react';
import { useRouteError, isRouteErrorResponse, useNavigate } from 'react-router-dom';
import { AlertTriangle, RotateCcw, Home } from 'lucide-react';

export default function RouteErrorBoundary() {
  const error = useRouteError();
  const navigate = useNavigate();

  let title = 'Something went wrong';
  let message = 'An unexpected error occurred while loading this page.';

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = 'Page Not Found';
      message = "The page you are looking for doesn't exist or has been moved.";
    } else if (error.status === 401) {
      title = 'Unauthorized';
      message = 'You do not have access to this page.';
    } else if (error.status === 503) {
      title = 'Service Unavailable';
      message = 'Our services are temporarily unavailable. Please try again later.';
    } else {
      title = `Error ${error.status}`;
      message = error.statusText || message;
    }
  } else if (error instanceof Error) {
    message = error.message;
  }

  const handleReload = () => {
    window.location.reload();
  };

  const handleGoHome = () => {
    navigate('/adstudio');
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#0d0f12] text-white p-6">
      <div className="max-w-md w-full bg-[#161922] border border-[#232734] rounded-2xl p-8 text-center shadow-2xl flex flex-col items-center">
        <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-5 text-red-400">
          <AlertTriangle size={32} />
        </div>

        <h1 className="text-2xl font-bold text-white mb-2">{title}</h1>
        <p className="text-sm text-gray-400 mb-6 leading-relaxed">
          {message}
        </p>

        {import.meta.env.DEV && error?.stack && (
          <div className="w-full text-left bg-[#0f1117] border border-[#232734] rounded-lg p-3 mb-6 max-h-36 overflow-auto text-xs font-mono text-red-300">
            {error.stack}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3 w-full">
          <button
            onClick={handleReload}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-medium text-sm transition-all shadow-lg shadow-blue-500/20 active:scale-[0.98]"
          >
            <RotateCcw size={16} />
            Try Again
          </button>
          <button
            onClick={handleGoHome}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#232734] hover:bg-[#2d3243] text-gray-200 font-medium text-sm transition-all active:scale-[0.98]"
          >
            <Home size={16} />
            Go to Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
