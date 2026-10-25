---
title: 索尼 Xperia XZ1 日版（SOV36）解锁 BL 并装 LineageOS 21 + APatch
date: 2026-10-25
category: 玩机
---

# 索尼 Xperia XZ1 日版（SOV36）解锁 BL 并装 LineageOS 21 + APatch  

手里这台是 au 版的 Xperia XZ1，型号 SOV36，系统还停在官方 Android 9。这机器的底子其实不差，骁龙 835，4GB 内存，但官方早就停止更新了。想让它再战几年，只能走解锁 BL → 刷第三方 ROM 这条路。

中间踩了不少坑，包括 bootloop、信号丢失、开机卡引导页。这篇文章只写最后跑通的流程，末尾单独列出容易翻车的地方。机器型号虽然是 SOV36，但 XZ1 全系（G8341/G8342/SOV36/SOV37）的流程大同小异，代号都是 `poplar`。

## 一、准备东西

先把需要的文件凑齐，后面就不用手忙脚乱。

**工具**

- platform-tools（adb 和 fastboot）：<https://developer.android.com/tools/releases/platform-tools>
- newflasher，刷 FTF 用的：<https://github.com/Munjeni/newflasher>
- 对应型号的原厂 FTF 固件。我准备了两个，Android 8 的 `47.1.C.9.106` 和 Android 9 的 `47.2.C.1.126`，后缀 `1309-3370` 是 au 的定制号

**ROM**

- LineageOS 21 microG 版：<https://download.lineage.microg.org/poplar/>
  - 这台机器官方 LineageOS 没有构建，microG 这个源反而一直在更新
- APatch：<https://github.com/bmax121/APatch>

**驱动**

Windows 上要装两个驱动，一个是 SOMC Flash Device（Flashmode 用，PID 是 `0FCE:B00B`），一个是 Sony ADB/Fastboot 驱动。装完之后设备管理器里能看到 `SOMC Flash Device` 才算没问题。

**备份（重要）**

解锁 BL 之前必须先把 TA 分区备份出来。TA 里存着 DRM 密钥、相机矫正数据、序列号这些，一旦解锁被清掉就再也拿不回来了。即使你的国家版本解锁不会清 TA（日版和部分欧版不会），也建议备份一份。

```
adb pull /dev/block/sda1  TA.img
adb pull /dev/block/sda33 persist.img
```

`sda1` 是 TA，`sda33` 是 persist。分区号在别的机器上可能不一样，先用 `ls -l /dev/block/by-name/` 对一下名字再动手。

## 二、解锁 bootloader

Sony 的解锁流程需要先去官网申请解锁码，绑定 IMEI。

打开 <https://developer.sony.com/open-source/aosp-on-xperia-open-devices/get-started/unlock-bootloader>，选你的机型，填入 IMEI（拨号盘输入 `*#06#` 能查），会拿到一串 16 位的解锁码。

然后进 fastboot 模式：**按住音量加，插 USB 线**，等指示灯变蓝。

```
fastboot oem unlock 0x你的解锁码
```

回车之后手机会自己擦数据并重启。这一步不可逆，数据会全丢，所以前面该备份的东西必须先备份。

验证一下：

```
fastboot getvar unlocked
```

返回 `unlocked: yes` 就成功了。

## 三、刷回原厂固件

这一步容易被跳过，但很关键。rom 的 assert 会检查 `ro.product.device`，而你手上的机器如果是跨区版本，名字对不上就会直接 `E3004` 报错刷不进去。

先解压 FTF 到工作目录。newflasher 需要一个单独的空文件夹，把所有 `.sin` 文件（包括 `partition/` 子目录里的）和 `newflasher.exe` 都放进去。

然后进 Flashmode：**按住音量减，插 USB 线**，指示灯变绿。

在命令行里跑：

```
newflasher.exe
```

它会问你几个问题：

- 要不要下载 GordonGate 驱动 → `n`
- 刷完重启到哪个模式 → 输入 `a`（重启进 Android）
- 要不要 dump TA → `n`（我们已经备份过了）

然后它就开始刷了。整个过程大概 5 到 10 分钟，中途别拔线。

刷完之后第一次开机会很慢，可能要三五分钟。如果卡在 Sony 的开机动画一直转圈，多半是 `userdata` 的加密密钥跟新固件不匹配，进 fastboot 格式化一下就行：

```
fastboot format userdata
fastboot format cache
```

## 四、刷 LineageOS

进 fastboot（音量加 + 插线），先刷 boot 和 recovery。

```
fastboot flash boot boot.img
fastboot flash FOTAKernel recovery.img
```

这两个文件从 LineageOS 的 zip 包里解出来，`boot.img` 在根目录，`recovery.img` 也在根目录。

然后进 recovery：

```
fastboot boot recovery.img
```

设备会重启进入 LineageOS 的恢复界面。这时候用 adb 连：

```
adb devices
```

第一次连会显示 `unauthorized`，手机上会弹一个「允许 USB 调试吗」的对话框，点允许。

接着进 sideload 模式，recovery 界面里选 **Apply update → Apply from ADB**。电脑这边执行：

```
adb sideload lineage-21.0-xxxxxxxx-microG-poplar.zip
```

进度走到 `Total xfer: 1.00x` 就说明刷完了。如果中途断了，重新进 sideload 再刷一遍就行。

刷完之后建议把 data 清一下，尤其是之前刷过别的 ROM 的话：

在 recovery 里选 **Factory reset → Format data**，输入 `yes` 确认。

然后重启进系统。

## 五、装 APatch

APatch 是内核级别的 root 方案，工作机制跟 Magisk 不一样，改的是 boot.img 而不是挂载 overlay，所以隐藏性更好。

先把 APatch 装上：

```
adb install APatch-xxxxxxxx.apk
```

然后取出当前系统的 boot：

```
adb shell "dd if=/dev/block/by-name/boot of=/sdcard/boot.img"
adb pull /sdcard/boot.img
```

或者直接从 LineageOS 的 zip 里解 `boot.img` 出来，效果一样。

把 `boot.img` 推到手机上，打开 APatch 应用：

- 主界面点 **安装**
- 选 **选择并修补一个镜像文件**
- 挑 `/sdcard/boot.img`
- 等它跑完

处理完会在 `/sdcard/Download/` 下生成一个 `apatch_patched_xxxx.img`，把它拉回电脑。

```
adb pull /sdcard/Download/apatch_patched_xxxx.img
```

进 fastboot 刷进去：

```
fastboot flash boot apatch_patched_xxxx.img
fastboot reboot
```

开机之后验证：

```
adb shell "su -c id"
```

返回 `uid=0(root)` 就成了。

## 六、几个容易出问题的点

**1. 千万别刷 bootloader 文件**

FTF 里的 `boot/` 目录下那几个 `bootloader_*.sin` 和 `.ta` 文件不要刷。刷了有可能重新上锁，甚至变砖。解压的时候直接跳过 `boot/` 整个目录。同理，任何 `.ta` 文件都不要手动刷，容易把 DRM 密钥搞坏。

**2. 别跨区刷固件**

XZ1 的 SOV36（日版）如果刷了 G8341（国际版）或者 G8342（国行）的完整固件，会出现 SIM 卡不识别、IMEI 丢失的问题。这个坑有人踩过，XDA 上专门有个帖子：<https://xdaforums.com/t/4463019/>。

如果要换区，正确做法是保留本机的 modem 和 baseband，只刷 system/vendor 部分。或者干脆别换。

**3. `ro.product.device` 对不上会报 E3004**

LineageOS 官方的 `poplar` 版和运营商定制的 `poplar_kddi` 版是两个不同的包，assert 检查的名字不一样。`poplar_kddi` 的包只能刷在 `ro.product.device` 是 `poplar_kddi` 的机器上，反过来也一样。

刷之前先确认：

```
adb shell getprop ro.product.device
```

名字不对就先刷对应的原厂固件，把标识改过来再刷 ROM。

**4. 卡在开机引导页**

刷完固件第一次开机，如果停在「卡槽和接口说明」这类页面滑不动，通常是 `userdata` 的加密格式跟新系统不兼容。别慌，进 fastboot 格式化 `userdata` 和 `cache` 就好，数据本来也是要清的。

**5. 关于 VoLTE 和通话**

XZ1 的日版机器插中国运营商的卡，大概率是无法通话的。这不是 ROM 的问题，根源在 modem 固件：

- 系统的 `mVopsSupport` 属性返回 2，表示 modem 明确报告不支持 VoLTE，这个值从上层改不了
- `/system/etc/customization/modem/` 下面那一百多个 MBN 文件里，没有任何一个是中国运营商的配置
- MCC 460（中国）目录下的 `modem.conf` 只是个占位符，指向别的国家的配置
- 中国移动已经把 2G/3G 语音关了，联通在 LTE-only 模式下也没有 CS Fallback 的回退通道

换 ROM、换 Android 版本、刷定制版 LineageOS，我都试过了，通话问题依旧。所以如果通话是刚需，这台机器只能当备用机或者平板用。

**6. APatch 刷完后如果丢了 root**

如果之后清了 data 或者恢复出厂设置，`/data/adb` 会被清空，APatch 的守护进程就没了，`su` 会失效。这时候重新打开 APatch 应用，重新 patch 一次 boot 再刷就行，boot 分区本身不一定需要动。

**7. adb 连接不稳定**

Windows 上如果同时装了 Android Studio 或者手机助手之类的软件，它们可能占着 5037 端口，导致 adb 版本冲突。报错信息大概是 `adb server version (40) doesn't match this client (41)`。把冲突的 adb 进程全杀掉，再重启 adb 服务就能解决。

## 参考链接

- Sony 官方解锁页：<https://developer.sony.com/open-source/aosp-on-xperia-open-devices/get-started/unlock-bootloader>
- newflasher：<https://github.com/Munjeni/newflasher>
- LineageOS microG 版下载：<https://download.lineage.microg.org/poplar/>
- poplar 设备源码：<https://github.com/whatawurst/android_device_sony_poplar>
- XDA 的 LineageOS 21 发布帖：<https://xdaforums.com/t/14-rom-lineageos-21-0-unofficial-1-0-2024-02-25.4659246/>
- XDA 的跨区刷机避坑帖：<https://xdaforums.com/t/4463019/>
- APatch：<https://github.com/bmax121/APatch>
- poplar_kddi 的 LineageOS 构建（SourceForge）：<https://sourceforge.net/projects/yoshino/files/poplar/lineage-21.0/>
