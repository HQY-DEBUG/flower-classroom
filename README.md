# 花伴课堂 · Flower Classroom

当前源码快照：`1.3.0-rc.19`。面向离线课堂的 Electron 桌面应用，提供班级与学生管理、积分记录、共享计分卡、分组、点名、宠物养成、悬浮工具、备份及旧版数据迁移。

## RC19 的主要规则

- 宠物等级统一按学生当前积分计算；默认累计门槛为 5、15、30、50、70、90、110，之后每级默认增加 20 分
- 配置表展示至 25 级的费用与累计门槛，数值等级在 25 级后仍可继续增加；宠物外观最多七段造型，不把数值等级与造型数量混为一谈
- 40 种宠物、默认卡通头像；所有面板共享计分卡和全局进阶，其他面板设置独立保存
- 旧成长记录、毕业快照和徽章保留；独立成长操作及新增毕业暂不启用，旧成长规则不再决定当前等级
- 根目录 `配置.xlsx` 是活动配置工作簿，外部改动需整本预览并确认；窗口启动参数在完整重启后生效

## 开发与常用命令

安装 Node.js/npm，在仓库根目录执行：

```sh
npm ci
npm start
```

```sh
npm test           # Node 测试
npm run check     # 入口语法检查及 Node 测试
npm run preview   # 浏览器预览
npm run test:ui   # 既有 UI 测试入口
npm run build:win # Windows x64 ZIP 构建
```

精确依赖版本以 `package-lock.json` 为准。图形界面测试、历史验收脚本和打包还需要对应系统、工具及输入文件；部分脚本依赖额外 Python 包和历史打包产物。浏览器预览不等同于 Electron 或 Windows 实机验收。

## 源码与历史

本仓库在 **2026-10-08** 从已有 RC17、RC18、RC19 源码归档重建提交顺序，并补充文档。三版快照的冻结日期均为 **2026-10-07**。这些导入提交不是原始开发提交，也不代表恢复了更早的 Git 历史。版本变化见 [CHANGELOG.md](CHANGELOG.md)。

- 保留全部 `src/`、`assets/`、`scripts/`、`tests/`、依赖清单和原有 `LICENSE`
- 保留 `artifacts/` 中的历史代码、CSS、HTML、补丁及 `package.json`，不因目录名而删去代码
- RC19 导入清单有 **1400 个来源文件**；文档及 `.gitignore` 另计，逐文件摘要见 [source-manifest.json](docs/source-manifest.json)
- 历史脚本的原工作目录前缀改为通用 `/tmp/flower-classroom-workspace`；应用 `src/` 与相应归档逐字节一致
- 合成/虚构测试人物、模拟状态和未绑定初始配置模板用于回归测试；不纳入真实学生名单、课堂运行数据、备份、凭据、原始日志、截图、报告输出或 Windows 二进制包
- 旧脚本引用的历史证据和运行目录可能不在仓库内，保留代码不代表旧环境已完整复原

## 已验证与尚未验证

2026-10-08 **03:04 UTC，环境重置前**的导入副本曾按锁文件执行 `npm ci --ignore-scripts`，随后 `npm run check` 的 **834 项测试全部通过，0 项失败**。Electron 安装生命周期脚本未执行。该结果是此前已确认的检查记录，**重置后没有声称重新运行这批测试**。

重建后另行核对了来源清单和 `src/` 字节一致性。机器可读记录见 [import-verification.json](docs/import-verification.json)。历史验收数字与此次 Node 测试采用不同口径，不应相加。

此次源码整理没有执行 Electron UI 回归、Windows 实机测试或 Windows 构建。以下 **9 项 Windows 现场行为仍未验证**，Linux、模型检查和接口存在不能替代实机证据：

1. 缩放、默认大小和全屏的原生菜单及快捷键（V033）
2. 红花悬浮入口覆盖全屏 PowerPoint/WPS（V035）
3. 积分窗拖移、窄栏化及名单滚动（V037）
4. 全屏课件切页时积分侧栏的可见性与焦点（V038）
5. 圆形透明悬浮计时器的透明、拖移和操作（V052）
6. 三种提示音的实际播放（V054）
7. 独立窄宠物窗覆盖全屏 PPT（V067）
8. Windows 目录版路径、搬移、副本及只读行为（R14-W01）
9. 资源管理器打开目录、Excel/WPS 打开与占用工作簿的实机行为（R14-W02）

Windows 可执行文件签名和 SmartScreen 信誉问题仍未解决，当前构建配置未启用可执行文件签名。报告工作簿的程序化读写不能证明已在原生 Excel/WPS 中完成验证。

## 许可

原快照已有的 MIT [LICENSE](LICENSE) 原样保留；本次未新增或更换许可。


## 查看迭代历史

`main` 保留完整最新 RC19。历史快照位于 [release-history 提交历史](https://github.com/HQY-DEBUG/flower-classroom/commits/release-history/)，按 RC17 → RC18 → RC19 排列，并附有源码清单与验证说明。

- [RC17 源码快照](https://github.com/HQY-DEBUG/flower-classroom/commit/7648a0c02648df0ce4f063cacbd40208d2682046)
- [RC18 源码快照](https://github.com/HQY-DEBUG/flower-classroom/commit/5dbb7dd034e0afb379f83235aa3b20797ebeb281)
- [RC19 源码快照](https://github.com/HQY-DEBUG/flower-classroom/commit/cdd2e520df6a7451fa5a3d1dbc82dbc17e5fae17)

这些是 2026-10-08 从已保存的发布归档重建的导入提交，版本冻结时间为 2026-10-07；并非补造此前逐次开发提交或日期。RC19 历史快照与 `main` 的业务源码一致，`main` 另含仓库说明文档。
