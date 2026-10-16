# Minecraft Skin Editor

> **Disclaimer** — "Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft."
> 本项目是非官方粉丝工具，与 Mojang / Microsoft / 网易无任何关联。

**我的世界皮肤编辑器**

**岂曰无衣，与子同袍**

*"How can you say you have no robe? I will share mine with you." — Book of Songs, Qin Feng*

浏览器里的 Minecraft 皮肤编辑器 —— **纯前端、零上传**：所有绘制、合成、导出都在你自己的浏览器里完成，皮肤文件不会经过任何服务器。

## 功能

- **绘制**：铅笔 / 橡皮 / 取色 / 油漆桶，最近使用颜色，撤销重做，自动保存草稿。
- **多源合成**：选两个皮肤作为源，按部件（头 / 身 / 四肢）与层（第一层 / 第二层）分别指派来源；跨体型合成时自动做手臂重映射（宽型 4 像素 ↔ 纤细 3 像素）。
- **导出**：标准 64×64 PNG，文件名带体型，可直接用于 Minecraft。
- **作品库**：每次导出自动入库，列表带 3D 等距头部预览；支持一键导出 / 导入 JSON 备份。

## 快速开始

```bash
npm install
npm run dev      # 本地开发（http://127.0.0.1:5173）
npm run build    # 类型检查 + 生产构建，产物在 dist/
```

## 验证

一套无浏览器依赖的纯函数验证（导出闭环 / 等距头部渲染 / 作品库备份），一条命令跑完：

```bash
npm run verify
```

细节与浏览器手测清单见 [docs/TESTING.md](docs/TESTING.md)，架构约定见 [docs/DEV-NOTES.md](docs/DEV-NOTES.md)。

## 隐私

**零上传。** 所有数据只存在你自己的浏览器里（`localStorage`）：草稿、最近使用颜色、作品库，都不上传任何服务器，本工具也没有后端。

因此请在**清理浏览器数据之前**先用作品库的「导出备份」存一份 JSON，否则作品会随浏览器数据一起消失。

## 兼容

建议使用桌面版 **Chrome / Edge**（Firefox、Safari 可用但未充分测试）。界面按桌面宽度设计，移动端未做适配。

## 支持

如果你觉得有用，可以请我喝杯茶。

> 打赏链接（爱发电）唯一维护在 `src/constants.ts` 的 `SUPPORT_URL`；当前留空，
> 因此 README 不展示链接，界面上也不显示任何打赏入口。填入后两端同时生效。

## 许可

[MIT](LICENSE) © 2026 Goodcati
