import { defineTool } from '../../renderer/shared/tool/defineTool.js';
import IdCardGeneratorPage from './renderer/pages/IdCardGenerator.vue';

const tool = defineTool({
  id: 'id-card-generator',
  name: '身份证号生成器',
  description: '随机生成中国大陆18位身份证号',
  version: '1.0.0',
  color: '#8b5cf6',
  category: { key: 'generator', name: '生成器' },
  keywords: ['id', 'identity', 'generator', '身份证', '证件号码', '随机生成'],
  supportedTargets: ['web', 'win', 'mac'],
  createdAt: '2026-08-15',
  route: {
    path: 'id-card-generator',
    component: IdCardGeneratorPage,
  },
});

export default tool;
