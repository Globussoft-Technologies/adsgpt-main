import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Sparkles } from 'lucide-react';

const UpgradeModal = ({ isOpen, onClose, onUpgrade }) => {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-[400px] border-none bg-[#1C1C1F] text-white shadow-[0_0_50px_rgba(0,0,0,0.5)] backdrop-blur-2xl sm:rounded-[32px]">
        <DialogHeader className="flex flex-col items-center gap-4 pt-4">
          <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-b from-[#49bcdc] to-[#3a4cee] shadow-[0_0_30px_rgba(88,103,235,0.4)]">
            <div className="absolute inset-0.5 rounded-full bg-gradient-to-b from-white/20 to-transparent blur-[1px]" />
            <Sparkles className="relative h-10 w-10 text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.8)]" />
          </div>
          <DialogTitle className="text-2xl font-bold tracking-tight">Upgrade Your Plan</DialogTitle>
          <DialogDescription className="text-center text-sm text-white/50">
            Unlock premium features and more advanced AI models to create stunning videos.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="mt-8 flex flex-col items-center gap-3 sm:flex-col sm:justify-center">
          <Button
            onClick={onUpgrade}
            className="active_container relative flex h-8 w-full max-w-[200px] items-center justify-center rounded-full rounded-sm bg-gradient-to-r from-[#15DCFF] to-[#6b72f8] font-bold text-white shadow-[0_0_30px_rgba(88,103,235,0.4)] transition-all hover:scale-[1.02] active:scale-[0.98] 2xl:h-10 dark:hover:bg-[#2A2A2A]/70"
          >
            <span className="relative z-10">Upgrade Now</span>
            <div className="absolute inset-0 bg-gradient-to-r from-white/20 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
          </Button>
          <Button
            variant="ghost"
            onClick={onClose}
            className="h-10 text-white/40 transition-colors hover:bg-transparent hover:text-white"
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default UpgradeModal;
