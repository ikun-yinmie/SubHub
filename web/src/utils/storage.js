/**
 * 获取本地存储项
 * @param {string} itemKey - 存储键
 * @returns {string} 存储值
 */
export const getLocalStorageItem = (itemKey) => {
  const now = +new Date();
  let ls = localStorage.getItem(itemKey);

  let itemValue = '';
  if (ls !== null) {
    let data = JSON.parse(ls);
    if (data.expire > now) {
      itemValue = data.value;
    } else {
      localStorage.removeItem(itemKey);
    }
  }

  return itemValue;
};

/**
 * 删除本地存储项
 *
 * 用户把输入清空时必须真的删掉。只"不再写入"是不够的：之前存的那份会一直在
 * 浏览器里，下次打开页面又冒出来 —— 粘贴过节点配置的人会以为泄漏了。
 * @param {string} itemKey - 存储键
 */
export const removeLocalStorageItem = (itemKey) => {
  localStorage.removeItem(itemKey);
};

/** 清掉已过期的项：过期值原先只在下一次读到同一个键时才被删，会一直躺在 localStorage 里 */
const purgeExpired = () => {
  const now = +new Date();
  for (let i = localStorage.length - 1; i >= 0; i -= 1) {
    const key = localStorage.key(i);
    try {
      const data = JSON.parse(localStorage.getItem(key));
      if (data && typeof data.expire === 'number' && data.expire <= now) {
        localStorage.removeItem(key);
      }
    } catch (error) {
      // 不是本工具写的格式，不动它
    }
  }
};

/**
 * 设置本地存储项
 * @param {string} itemKey - 存储键
 * @param {string} itemValue - 存储值
 * @param {number} ttl - 生存时间（秒）
 */
export const setLocalStorageItem = (itemKey, itemValue, ttl) => {
  const now = +new Date();

  purgeExpired();

  let data = {
    setTime: now,
    ttl: parseInt(ttl),
    expire: now + ttl * 1000,
    value: itemValue
  };
  localStorage.setItem(itemKey, JSON.stringify(data));
};
