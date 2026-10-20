
import React from 'react';
import { Icons } from '../constants';

interface PaginationProps {
  currentPage: number;
  totalLinks: number;
  itemsPerPage: number;
  onPageChange: (page: number) => void;
}

export const PaginationBar: React.FC<PaginationProps> = ({ 
  currentPage, 
  totalLinks, 
  itemsPerPage, 
  onPageChange 
}) => {
  const totalPages = Math.ceil(totalLinks / itemsPerPage);

  if (totalPages <= 1) return null;

  const handlePageClick = (page: number) => {
    if (page === currentPage) return;
    
    onPageChange(page);
    
    // When manually changing pages, scroll to top of the specific container or window
    const scrollContainer = document.getElementById('scroll-area');
    if (scrollContainer) {
      scrollContainer.scrollTo({ top: 0, behavior: 'instant' });
    } else {
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  };

  const renderPages = () => {
    const pages = [];

    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Logic for many pages
      if (currentPage <= 4) {
        // Near the start: 1 2 3 4 5 ... totalPages
        for (let i = 1; i <= 5; i++) {
          pages.push(i);
        }
        pages.push('ellipsis-end');
        pages.push(totalPages);
      } else if (currentPage >= totalPages - 3) {
        // Near the end: 1 ... totalPages-4 totalPages-3 totalPages-2 totalPages-1 totalPages
        pages.push(1);
        pages.push('ellipsis-start');
        for (let i = totalPages - 4; i <= totalPages; i++) {
          pages.push(i);
        }
      } else {
        // In the middle: 1 ... currentPage-1 currentPage currentPage+1 ... totalPages
        pages.push(1);
        pages.push('ellipsis-start');
        pages.push(currentPage - 1);
        pages.push(currentPage);
        pages.push(currentPage + 1);
        pages.push('ellipsis-end');
        pages.push(totalPages);
      }
    }

    return pages.map((page) => {
      if (typeof page === 'string') {
        return (
          <span key={page} className="text-[var(--text-muted)] opacity-40 px-1.5 select-none text-[15px] font-bold">
            ...
          </span>
        );
      }

      return (
        <button
          key={page}
          onClick={() => handlePageClick(page)}
          className={`relative transition-all duration-200 min-w-[32px] sm:min-w-[40px] h-9 sm:h-10 px-1.5 sm:px-2 rounded-full flex flex-col items-center justify-center text-[13px] sm:text-[15px] font-bold active:scale-90 tap-highlight-none shrink-0 ${
            currentPage === page 
              ? 'text-[var(--text-primary)]' 
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/5'
          }`}
        >
          <span>{page}</span>
          {currentPage === page && (
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] absolute bottom-1 sm:bottom-1.5" />
          )}
        </button>
      );
    });
  };

  return (
    <div className="w-full py-4 sm:py-5 flex items-center justify-center px-1 sm:px-4 select-none max-w-full overflow-x-auto no-scrollbar">
      <div className="flex items-center gap-0.5 sm:gap-1.5 shrink-0">
        <button
          onClick={() => handlePageClick(Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
          className={`w-10 h-10 rounded-full flex items-center justify-center transition-all tap-highlight-none ${
            currentPage === 1 ? 'opacity-20 cursor-not-allowed' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10 active:scale-90'
          }`}
        >
          <Icons.ChevronLeft size={20} />
        </button>
        
        <div className="flex items-center gap-0.5">
          {renderPages()}
        </div>

        <button
          onClick={() => handlePageClick(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage === totalPages}
          className={`w-10 h-10 rounded-full flex items-center justify-center transition-all tap-highlight-none ${
            currentPage === totalPages ? 'opacity-20 cursor-not-allowed' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10 active:scale-90'
          }`}
        >
          <Icons.ChevronRight size={20} />
        </button>
      </div>
    </div>
  );
};
