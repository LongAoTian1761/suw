# submissions/

审核通过的同学附件放在这里，按习题编号分文件夹：

```
submissions/
  2.1/
    2_1_handwriting.pdf
    hand-derivation.svg
  2.12/
    solve_global.m
```

然后在 `data/answers.json` 里用**相对于站点根目录**的路径引用：

```json
"attachments": [
  { "name": "2_1_handwriting.pdf", "url": "submissions/2.1/2_1_handwriting.pdf", "size": "412 KB" }
]
```

也可以直接使用外部链接（例如 GitHub Issue 里上传后自动生成的
`https://github.com/user-attachments/...` 地址），`url` 支持 `http(s)` 开头的绝对地址。

当前目录下的文件都是**占位文件**，用来演示附件在答案卡片里的显示效果，请替换成真实内容。

## 关于文件大小

GitHub 单个文件建议不超过 25 MB，仓库总体建议不超过 1 GB。扫描件请压缩后再提交；
较大的数据集建议放到网盘或 Zenodo，然后在答案正文里贴链接。
