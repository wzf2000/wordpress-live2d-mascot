# 使用文档

适用于 WordPress Live2D Mascot **3.12.0**。第一次使用从安装指南开始；旧版本请查看对应 Release 源码中的文档。

本版增加角色加载阶段提示、取消加载和 **更多 → 恢复自然状态**：可结束互动、清除气泡并回到待机与默认表情，保留原有偏好。显示、手机显示或条款偏好无法保存时会持续提示；加载中关闭面板或按 Escape 后，焦点会回到可见按钮。后台保留保存前试播、多角色模板复核，以及按需配置的资源隔离与还原；管理员可通过本地诊断查看首帧资源耗时。配置方法见[互动与偏好指南](INTERACTIONS.md#配置台词)，资源维护见[常见问题与维护](TROUBLESHOOTING.md)。完整变化见[发行说明](https://github.com/wzf2000/wordpress-live2d-mascot/releases/tag/v3.12.0)。

| 你想做什么 | 阅读入口 |
| --- | --- |
| 下载、安装，准备 Core 与模型 ZIP | [安装与资源准备](INSTALL.md) |
| 换角色、台词、快捷互动、拖动、手机显示 | [互动与偏好指南](INTERACTIONS.md) |
| 处理导入、显示、任务中断或资源问题 | [常见问题与维护](TROUBLESHOOTING.md) |
| 了解素材来源、署名与分发条件 | [发行与许可](DISTRIBUTION.md) |
| 构建插件、接入通知与阅读暂停 | [开发与站点集成](DEVELOPMENT.md) |
| 记录实体设备加载与帧率 | [设备采样与离线汇总](DEVICE_SAMPLING.md) |
| 查看本版和历史更新 | [GitHub Releases](https://github.com/wzf2000/wordpress-live2d-mascot/releases) |

## English entry points

The plugin interface supports **en_US / zh_CN**. Version 3.12.0 shows loading stages with a cancel button. In More, Restore natural state clears speech bubbles and returns the character to idle and its default expression while keeping your preferences. Failed preference saves remain visible, and closing the panel or pressing Escape during loading returns keyboard focus to a visible control. Advanced controls stay collapsed by default; draft previews, batch templates, resource recovery and administrator-only diagnostics remain available. Administrators obtain Core and models separately; installation packages contain neither. Start with [setup and licensing](DISTRIBUTION.md#administrator-setup), then see [physical-device sampling](DEVICE_SAMPLING.md). The remaining guides are maintained primarily in Chinese; code identifiers and API examples retain their original names.

## 项目入口

[项目首页](../README.md) · [下载 3.12.0](https://github.com/wzf2000/wordpress-live2d-mascot/releases/tag/v3.12.0) · [反馈问题](https://github.com/wzf2000/wordpress-live2d-mascot/issues)
