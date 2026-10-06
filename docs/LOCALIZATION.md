# 中英界面

默认语言由 `config/settings.json` 的 `defaultLanguage` 决定，支持：

- `"zh-CN"`：简体中文（缺省值）
- `"en"`：英文

在现有设置文件中增加或修改这一项即可；不要覆盖其他设置：

```json
"defaultLanguage": "zh-CN"
```

也可以在仪表盘“设置 → 默认语言”中选择并保存。页面右上角的“中文 / EN”立即切换当前页面，不刷新页面、不重建监控连接、不清除表单草稿，也不修改默认语言。重新打开或刷新页面时读取配置文件中的默认值。

语言资源位于 `src/i18n/zh-CN.json`，英文原文作为键。组件通过 `t()` 翻译显示文案，通过 `useI18n()` 订阅语言变化。设备名称、模型标识、地址、端口、原始输出和数据单位保持原值；缺少翻译的文案回退英文。修改语言资源后需重新构建前端。

对应检查：

```bash
npm run typecheck
npm run test:frontend
node --test server/sparks/__tests__/settings-language.test.js
npm run build
```
