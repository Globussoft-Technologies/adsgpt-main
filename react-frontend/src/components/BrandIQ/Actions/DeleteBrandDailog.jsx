import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Loader2, Trash2 } from 'lucide-react';
import { useSelector } from 'react-redux';

const DeleteBrandDailog = ({ open, onOpenChange, onDelete }) => {
  const { deleteLoading, myBrands } = useSelector((state) => state.brandIQTabs);

  // const campaignNames = myBrands?.map((item) => item.campaigns?.map((item) => item.campaignName));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <button className="delete_option flex w-full items-center gap-1.5 rounded-sm p-2 text-xs hover:bg-white/10 2xl:text-sm">
          <Trash2 className="h-4 w-4" />
          Delete
        </button>
      </DialogTrigger>
      <DialogContent className="flex w-full !max-w-[380px] flex-col overflow-x-hidden rounded-[30px] !bg-white !backdrop-blur-[100px] sm:p-8 dark:!bg-[#303030]/50">
        <div className="icon prompt_selection_button mx-auto flex h-[52px] w-[52px] items-center justify-center rounded-full">
          <Trash2 className="w-6" />
        </div>
        <DialogHeader>
          <DialogTitle className="text-center font-medium">Delete Brand?</DialogTitle>
          <DialogDescription className="mx-auto my-2 max-w-[80%] text-center text-base">
            <p className="text-gray-500 dark:text-[#CCCCCC]">Are you sure you want to delete </p>
          </DialogDescription>
        </DialogHeader>
        {/* {campaignNames && campaignNames.length > 0 && (
          <div className="my-2 text-center text-xl text-[#CCCCCC]">
            Campaigns: <br />
            {campaignNames.join(',')}
          </div>
        )} */}
        <div className="flex w-full flex-col items-center justify-center space-y-2">
          <div className="flex w-full items-center justify-center space-x-3">
            <button
              className="prompt_selection_button h-[46px] rounded-[81px] bg-gray-100 px-8 py-2 text-base backdrop-blur-[130px] dark:bg-[#202020]/50"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </button>
            <button
              className="prompt_selection_button flex h-[46px] items-center justify-center gap-2 rounded-[81px] !bg-[#9D1414] px-8 py-2 text-base text-white! backdrop-blur-[130px]"
              onClick={onDelete}
            >
              {deleteLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                'Delete'
              )}
            </button>
          </div>
          {/* {error && (
            <p className="text-sm text-red-500">Unable to delete the brand. Please try again.</p>
          )} */}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default DeleteBrandDailog;
