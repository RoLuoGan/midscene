import { imageInfoOfBase64 } from '@/image/index';
import type { BaseElement, ElementTreeNode, Size, UIContext } from '@/types';
import { NodeType } from '@midscene/shared/constants';
import { vlLocateMode } from '@midscene/shared/env';
import {
  descriptionOfTree,
  generateElementByPosition,
  treeToList,
} from '@midscene/shared/extractor';
import { assert } from '@midscene/shared/utils';

export function describeSize(size: Size) {
  return `${size.width} x ${size.height}`;
}

export function describeElement(
  elements: (Pick<BaseElement, 'rect' | 'content'> & { id: string })[],
) {
  const sliceLength = 80;
  return elements
    .map((item) =>
      [
        item.id,
        item.rect.left,
        item.rect.top,
        item.rect.left + item.rect.width,
        item.rect.top + item.rect.height,
        item.content.length > sliceLength
          ? `${item.content.slice(0, sliceLength)}...`
          : item.content,
      ].join(', '),
    )
    .join('\n');
}
export const distanceThreshold = 16;

export function elementByPositionWithElementInfo(
  treeRoot: ElementTreeNode<BaseElement>,
  position: {
    x: number;
    y: number;
  },
  options?: {
    requireStrictDistance?: boolean;
    filterPositionElements?: boolean;
  },
) {
  const requireStrictDistance = options?.requireStrictDistance ?? true;
  const filterPositionElements = options?.filterPositionElements ?? false;

  assert(typeof position !== 'undefined', 'position is required for query');

  const matchingElements: BaseElement[] = [];

  function dfs(node: ElementTreeNode<BaseElement>) {
    if (node?.node) {
      const item = node.node;
      if (
        item.rect.left <= position.x &&
        position.x <= item.rect.left + item.rect.width &&
        item.rect.top <= position.y &&
        position.y <= item.rect.top + item.rect.height
      ) {
        if (
          !(
            filterPositionElements &&
            item.attributes?.nodeType === NodeType.POSITION
          ) &&
          item.isVisible
        ) {
          matchingElements.push(item);
        }
      }
    }

    for (const child of node.children) {
      dfs(child);
    }
  }

  dfs(treeRoot);

  if (matchingElements.length === 0) {
    return undefined;
  }

  // Find the smallest element by area
  const element = matchingElements.reduce((smallest, current) => {
    const smallestArea = smallest.rect.width * smallest.rect.height;
    const currentArea = current.rect.width * current.rect.height;
    return currentArea < smallestArea ? current : smallest;
  });

  const distanceToCenter = distance(
    { x: element.center[0], y: element.center[1] },
    position,
  );

  if (requireStrictDistance) {
    return distanceToCenter <= distanceThreshold ? element : undefined;
  }

  return element;
}

export function distance(
  point1: { x: number; y: number },
  point2: { x: number; y: number },
) {
  return Math.sqrt((point1.x - point2.x) ** 2 + (point1.y - point2.y) ** 2);
}

export const samplePageDescription = `
And the page is described as follows:
====================
The size of the page: 1280 x 720
Some of the elements are marked with a rectangle in the screenshot corresponding to the markerId, some are not.

Description of all the elements in screenshot:
<div id="969f1637" markerId="1" left="100" top="100" width="100" height="100"> // The markerId indicated by the rectangle label in the screenshot
  <h4 id="b211ecb2" markerId="5" left="150" top="150" width="90" height="60">
    The username is accepted
  </h4>
  ...many more
</div>
====================
`;

export async function describeUserPage<
  ElementType extends BaseElement = BaseElement,
>(
  context: Omit<UIContext<ElementType>, 'describer'>,
  opt?: {
    truncateTextLength?: number;
    filterNonTextContent?: boolean;
    domIncluded?: boolean | 'visible-only';
    visibleOnly?: boolean;
  },
) {
  const { screenshotBase64 } = context;
  let width: number;
  let height: number;

  if (context.size) {
    ({ width, height } = context.size);
  } else {
    const imgSize = await imageInfoOfBase64(screenshotBase64);
    ({ width, height } = imgSize);
  }

  const treeRoot = context.tree;
  // dfs tree, save the id and element info
  const idElementMap: Record<string, ElementType> = {};
  const flatElements: ElementType[] = treeToList(treeRoot);

  if (opt?.domIncluded === true && flatElements.length >= 5000) {
    console.warn(
      'The number of elements is too large, it may cause the prompt to be too long, please use domIncluded: "visible-only" to reduce the number of elements',
    );
  }

  flatElements.forEach((element) => {
    idElementMap[element.id] = element;
    if (typeof element.indexId !== 'undefined') {
      idElementMap[`${element.indexId}`] = element;
    }
  });

  let pageDescription = '';
  const visibleOnly = opt?.visibleOnly ?? opt?.domIncluded === 'visible-only';
  if (opt?.domIncluded || !vlLocateMode()) {
    // non-vl mode must provide the page description
    const contentTree = await descriptionOfTree(
      treeRoot,
      opt?.truncateTextLength,
      opt?.filterNonTextContent,
      visibleOnly,
    );

    // if match by position, don't need to provide the page description
    const sizeDescription = describeSize({ width, height });
    pageDescription = `The size of the page: ${sizeDescription} \n The page elements tree:\n${contentTree}`;
  }

  return {
    description: pageDescription,
    elementById(idOrIndexId: string) {
      assert(typeof idOrIndexId !== 'undefined', 'id is required for query');
      const item = idElementMap[`${idOrIndexId}`];
      return item;
    },
    elementByPosition(
      position: { x: number; y: number },
      size: { width: number; height: number },
    ) {
      return elementByPositionWithElementInfo(treeRoot, position);
    },
    insertElementByPosition(position: { x: number; y: number }) {
      const element = generateElementByPosition(position) as ElementType;

      treeRoot.children.push({
        node: element,
        children: [],
      });
      flatElements.push(element);
      idElementMap[element.id] = element;
      return element;
    },
    size: { width, height },
  };
}
