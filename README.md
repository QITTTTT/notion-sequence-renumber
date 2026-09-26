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

`.github/workflows/renumber.yml` 每 15 分钟运行一次。把本目录放进 GitHub 仓库后，在仓库 Settings → Secrets and variables → Actions 中新增：

- `NOTION_TOKEN`：Notion connection token

随后启用 Actions 即可。GitHub 定时任务可能有延迟，因此它不是严格实时触发；要做到变更后立即运行，需要 Notion webhook 加一个可公开访问的服务端点。

## 注意

- 不要把 `.env` 或 Notion token 提交到 GitHub。
- `投递时间` 建议使用 `6.24`、`9.10` 或 `2026-09-10` 这类格式。
- 这个脚本使用的是数据源 ID，不是数据库页面 ID。
