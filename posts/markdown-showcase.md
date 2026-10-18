---
title: 代码高亮与方法调用
description: 测试一下代码块、表格、引用这些富文本元素在主题下的样子。
date: 2025-10-08
tags:
  - 前端
  - 代码
category: 技术
---

这篇文章用来展示不同类型的 Markdown 元素渲染效果。

## 代码块

```ts
interface Post {
  title: string
  date: Date
  tags: string[]
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}
```

Python 也可以：

```python
from dataclasses import dataclass

@dataclass
class Anime:
    title: str
    year: int

    def is_classic(self) -> bool:
        return self.year < 2010
```

行内代码像是 `console.log('hello')` 这样。

## 引用

> 人类就是这样，明明知道会结束，却还是义无反顾地开始。
>
> 这句话不知道是谁说的，但每次看到都会愣一下。

## 列表

无序列表：

- 第一项
- 第二项
  - 嵌套的子项
  - 再来一个
- 第三项

有序列表：

1. 打开编辑器
2. 写点什么
3. 推送上去

## 表格

| 作品 | 年份 | 评分 |
| --- | --- | --- |
| 钢之炼金术师 | 2009 | ★★★★★ |
| 孤独摇滚 | 2022 | ★★★★★ |
| 轻音少女 | 2009 | ★★★★☆ |

## 强调

这是 **加粗**，这是 *斜体*，这是 ~~删除线~~，还有 `行内代码`。

## 分隔线

---

以上就是全部元素了。如果排版在一篇长文里依然舒适，说明主题是对味的。
