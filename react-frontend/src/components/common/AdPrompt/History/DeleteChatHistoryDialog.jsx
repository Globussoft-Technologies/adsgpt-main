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
import { Trash, Trash2, X } from 'lucide-react';

const DeleteChatHistoryDialog = ({ open, onOpenChange, onDelete }) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* <DialogTrigger asChild>
        <button className="delete_option flex w-full items-center gap-1.5 rounded-sm p-2 text-xs hover:bg-white/10 2xl:text-sm">
          <Trash2 className="h-4 w-4" />
          Delete
        </button>
      </DialogTrigger> */}
      <DialogContent className="z-55 flex w-full !max-w-[380px] flex-col gap-3 overflow-x-hidden rounded-[30px] !bg-[#303030]/50 !backdrop-blur-[100px] sm:p-8">
        <div className="icon mx-auto flex h-[52px] w-[52px] items-center justify-center rounded-full">
          <Trash2 className="w-6" />
        </div>
        <DialogHeader>
          <DialogTitle className="text-center font-medium">Delete Chat?</DialogTitle>
          <DialogDescription className="mx-auto my-2 max-w-[80%] text-center text-base">
            <p className="text-[#CCCCCC]">Are you sure you want to delete this chat. </p>
            {/* <p className="font-semibold text-white">Create Ad creative chat.</p> */}
          </DialogDescription>
        </DialogHeader>
        <div className="flex w-full items-center justify-center space-x-3">
          <button
            className="prompt_selection_button h-[46px] rounded-[81px] bg-[#202020]/50 px-8 py-2 text-base backdrop-blur-[130px]"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </button>
          <button
            className="prompt_selection_button h-[46px] rounded-[81px] !bg-[#9D1414] px-8 py-2 text-base backdrop-blur-[130px]"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDelete();
            }}
          >
            Delete
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default DeleteChatHistoryDialog;
