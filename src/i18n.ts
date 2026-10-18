import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const resources = {
  zh: {
    translation: {
      "nav": {
        "projects": "项目列表",
        "imageGen": "图片生成",
        "videoGen": "视频生成",
        "audioGen": "配音",
        "assets": "资产库",
        "settings": "系统设置"
      },
      "common": {
        "currentProject": "当前项目",
        "omniStudio": "O.M.N.I. Studio",
        "omniDesc": "全知制片系统"
      },
    }
  },
  en: {
    translation: {
      "nav": {
        "projects": "Projects",
        "imageGen": "Image Gen",
        "videoGen": "Video Gen",
        "audioGen": "Audio Gen",
        "assets": "Assets",
        "settings": "Settings"
      },
      "common": {
        "currentProject": "Current Project",
        "omniStudio": "O.M.N.I. Studio",
        "omniDesc": "Omniscient Hollywood Production System"
      },
    }
  }
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: "zh",
    fallbackLng: "en",
    interpolation: {
      escapeValue: false
    }
  });

export default i18n;
