import { useSelector } from 'react-redux';
import { motion } from 'framer-motion';
import { CategoryCard } from './components/CategoryCard';
import { fadeUpVariants, containerFadeUpVariants } from '@/utils/ui/framerMotionVariants';

const BASE = '/adcreative';

const DEFAULT_CATEGORIES = [
  {
    key: 'ai-creatives',
    title: ' AI Creatives',
    subtitle: ' Create custom Image ads ',
    emphasis: 'quiet',
    defaultImage: `${BASE}/ai.png`,
    hoverImage: `${BASE}/ai-hover.png`,
  },
  {
    key: 'lifestyle',
    title: 'Lifestyle Ad',
    subtitle: 'Model-led lifestyle creative',
    emphasis: 'quiet',
    defaultImage: `${BASE}/lifestyle.png`,
    hoverImage: `${BASE}/lifestyle-hover.gif`,
  },
  {
    key: 'product-shot',
    title: 'PRODUCT SHOT',
    subtitle: 'Turn your product to meaningful shot',
    emphasis: 'quiet',
    defaultImage: `${BASE}/product.jpg`,
    hoverImage: `${BASE}/product-hover.gif`,
  },
  {
    key: 'apps-saas',
    title: 'Apps / SaaS',
    subtitle: 'Device mockups and UI screens that convert',
    emphasis: 'loud',
    defaultImage: `${BASE}/saas.png`,
    hoverImage: `${BASE}/saas-hover.gif`,
  },
  {
    key: 'brand-awareness',
    title: 'Brand Awareness',
    subtitle: ' Identity-first creatives built around your colors, voice, and story.',
    emphasis: 'loud',
    defaultImage: `${BASE}/brand.jpg`,
    hoverImage: `${BASE}/brand-hover.gif`,
  },
];

export default function AdCreativeNewHome({ categories = DEFAULT_CATEGORIES, onSelectCategory }) {
  const { userData } = useSelector((state) => state.socket);
  const userName = userData?.user_name || 'User';

  return (
    <div className="layout_for_chat mx-auto h-full min-h-[55vh] w-full sm:p-0 2xl:min-h-[60vh]">
      <div>
        <div className="welcome_ad_copy_container flex h-full w-full items-center justify-center">
          <motion.div
            variants={containerFadeUpVariants}
            initial="hidden"
            animate="visible"
            className="mt-3 flex w-full flex-col items-center justify-center 2xl:mt-14"
          >
            <motion.h1
              variants={fadeUpVariants}
              custom={0}
              className="mb-2 bg-gradient-to-t text-center from-[#0c9fbd] to-[#5057d6] dark:from-[#15DCFF] dark:to-[#6b72f8] bg-clip-text text-2xl font-semibold text-transparent 2xl:mb-4 2xl:text-4xl"
            >
              Hello, {userName}
            </motion.h1>

            <motion.p
              variants={fadeUpVariants}
              custom={1}
              className="mb-6 text-center text-sm text-gray-500 dark:text-[#BEBEBE] 2xl:mb-8 2xl:text-base"
            >
              Create scroll-stopping Image ads with AI <br />
              that understands your business.
            </motion.p>

            <motion.div
              variants={fadeUpVariants}
              custom={2}
              className="flex w-full items-center justify-center pb-4 lg:h-[48vh] xl:h-[52vh] 2xl:h-[55vh]"
            >
              <div className="grid h-full w-full max-w-[650px] gap-2 grid-cols-2 lg:max-w-[1000px] lg:grid-cols-3 2xl:max-w-[1240px]">
                {categories.map((category, index) => (
                  <div key={category.key} className={`${index === 0 ? 'row-span-2' : ''}`}>
                    <CategoryCard
                      category={category}
                      onClick={onSelectCategory}
                      className="h-full w-full"
                    />
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
