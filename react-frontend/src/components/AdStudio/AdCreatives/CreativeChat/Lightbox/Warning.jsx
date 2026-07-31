import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Trash, Trash2, X, Save } from 'lucide-react';

const Warning = ({ open, onSave, onDelete, onClose }) => {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogTrigger asChild>
        <button className="flex w-full items-center gap-1.5 rounded-sm p-2 text-xs hover:bg-white/10 2xl:text-sm">
          <Trash2 className="h-4 w-4" />
          Delete
        </button>
      </DialogTrigger>
      <DialogContent className="flex w-full border border-white/10 dark:border-white/20 max-w-2xl flex-col overflow-x-hidden rounded-3xl !bg-[#0D0D0D]/30 !backdrop-blur-[50px] text-white sm:p-8">
        <DialogHeader>
          <DialogTitle className="text-white text-center">Unsaved Changes</DialogTitle>
          <DialogDescription className="mx-auto my-2 max-w-[80%] text-gray-200 dark:text-gray-100 text-center">
            Are you sure you want to discard this? Your file will be lost.
          </DialogDescription>
        </DialogHeader>
        <div className="flex w-full items-center justify-center space-x-3">
          <Button variant="destructive" onClick={onDelete}>
            <Trash className="mr-0 h-4 w-4" /> Discard
          </Button>
          <Button variant="outline" onClick={onSave} className="text-gray-900 dark:text-white">
            <Save className="mr-0 h-4 w-4" /> Save Changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default Warning;
