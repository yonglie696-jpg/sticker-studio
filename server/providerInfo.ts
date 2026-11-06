// 国内模型平台的说明数据（前后端共用，不要在这里 import Node 模块）
import type { ProviderId } from './types';

export const PROVIDER_IDS: ProviderId[] = ['bailian', 'ark', 'custom'];

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  short: string;
  recommended?: boolean;
  /** 控制台首页 */
  site?: string;
  /** 创建 API Key 的页面 */
  keyPage?: string;
  /** 通用兼容格式的文字模型接口（/chat/completions；AI 帮我想、测试连接用） */
  chatBase?: string;
  imageNote: string;
  /** 获取 Key 的步骤（向导里显示） */
  steps: string[];
  /** 条款提醒 */
  termsNote?: string;
}

export const PROVIDER_INFO: Record<ProviderId, ProviderInfo> = {
  bailian: {
    id: 'bailian',
    label: '阿里云百炼',
    short: '百炼',
    recommended: true,
    site: 'https://bailian.console.aliyun.com/',
    keyPage: 'https://bailian.console.aliyun.com/?tab=model#/api-key',
    chatBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    imageNote: '用千问图像模型出精灵图，可以带上角色参考图，保持每张长得一样',
    steps: [
      '用手机号注册阿里云账号，完成个人实名认证',
      '打开百炼控制台，阅读并同意服务协议，开通百炼。新用户可以领取各模型的免费额度（中国内地北京地域，有效期以控制台显示为准）',
      '在控制台的「免费额度」页面打开「免费额度用完即停」，这样额度用完会停下，不会自动扣钱',
      '进入「API Key」页面，点「创建 API Key」，归属选默认业务空间',
      '复制 sk- 开头的 Key，粘贴到下面。注意：不要用 Coding Plan / Token Plan 的专属 Key，它们不能抵扣免费额度',
    ],
  },
  ark: {
    id: 'ark',
    label: '火山方舟',
    short: '方舟',
    site: 'https://console.volcengine.com/ark',
    keyPage: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
    chatBase: 'https://ark.cn-beijing.volces.com/api/v3',
    imageNote: '用豆包 Seedream 生图模型出精灵图，可以带上角色参考图',
    steps: [
      '用手机号注册火山引擎账号，完成实名认证',
      '打开火山方舟控制台的「开通管理」，开通 Seedream 生图模型（要用「AI 帮我想」的话，再开通一个豆包文字模型）',
      '进入「API Key 管理」，创建一个 API Key。不要用 Coding Plan 的 Key，那种 Key 只能在编程工具里用，用在别处可能被封',
      '在「模型列表」里复制模型的 Model ID，填到「设置 → 火山方舟」对应的位置',
      '复制 ark- 开头的 API Key 本身（不要连名称、备注一起复制），粘贴到下面',
    ],
    termsNote:
      '火山方舟专用条款 3.1 写着“商业使用或以其他方式直接或间接获得收益”需要事先取得火山引擎的书面许可。表情上架拿赞赏算不算，我们还在向火山引擎确认，确认之前建议优先用阿里云百炼。',
  },
  custom: {
    id: 'custom',
    label: '自定义兼容接口',
    short: '自定义',
    imageNote: '通用兼容格式的 /images/generations 接口（不少国内平台都支持），参考图用 image 字段（data URI）传入',
    steps: ['填写接口地址（一般以 /v1 结尾）、生图模型名和 Key。请只接入在中国大陆合法提供服务的平台'],
  },
};

export const isProviderId = (v: unknown): v is ProviderId => typeof v === 'string' && (PROVIDER_IDS as string[]).includes(v);
