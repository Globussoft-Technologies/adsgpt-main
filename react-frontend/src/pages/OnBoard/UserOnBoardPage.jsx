import OnBoardHome from '@/components/OnBoard/OnBoardHome';
import { Loader } from 'lucide-react';
import { useSelector } from 'react-redux';

const UserOnBoardPage = () => {
  const { loading } = useSelector((state) => state.tourGuide);

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <Loader className="h-8 w-8 animate-spin text-gray-600" />
      </div>
    );
  }

  return <OnBoardHome />;
};

export default UserOnBoardPage;
