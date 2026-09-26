# 秋招投递记录：按投递时间自动重排序号

这个脚本读取 Notion 数据源中的所有记录，按“投递时间”从早到晚排序，并把普通数字列“序号”写成 `1, 2, 3, ...`。

当前设置：空白投递时间记录也参与编号，并排在最后。

## 一次运行

1. 在 Notion 中创建一个连接：<https://app.notion.com/developers/connections>
2. 给连接访问“秋招投递记录”数据库的权限。
3. 复制 `.env.example` 为 `.env`，填入连接 token。
4. 运行：

```bash
node --env-file=.env renumber.mjs
```

脚本只会更新序号发生变化的记录，并会自动处理分页和限流重试。

## 免费定时运行

`.github/workflows/renumber.yml` 每 5 分钟运行一次（GitHub Actions 支持的最短定时间隔）。把本目录放进 GitHub 仓库后，在仓库 Settings → Secrets and variables → Actions 中新增：

- `NOTION_TOKEN`：Notion connection token

workflow 文件需要提交到默认分支。配置好 Secret 后，打开 Actions → Notion 序号重排 → Run workflow，先手动运行一次并检查日志。

工作流使用 Node.js 24，无需安装额外依赖，每小时第 2、7、12、17、22、27、32、37、42、47、52、57 分钟自动运行，并避免多个任务同时重排。运行结果会输出总记录数和更新记录数。

如需更换目标数据源，在同一设置页面的 Variables 中添加 `NOTION_DATA_SOURCE_ID`；不设置时使用脚本内现有的数据源 ID。连接必须能访问目标数据库并拥有更新内容权限。

GitHub 定时任务可能有延迟，因此它不是严格实时触发；要做到变更后立即运行，需要 Notion webhook 加一个可公开访问的服务端点。公开仓库连续 60 天没有活动时，定时工作流可能被自动停用，需要在 Actions 中重新启用。

## 注意

- 不要把 `.env` 或 Notion token 提交到 GitHub。
- `投递时间` 建议使用 `6.24`、`9.10` 或 `2026-09-10` 这类格式。
- 这个脚本使用的是数据源 ID，不是数据库页面 ID。
