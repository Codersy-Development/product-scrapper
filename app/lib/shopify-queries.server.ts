export const PRODUCT_CREATE_MUTATION = `#graphql
  mutation productCreate($product: ProductCreateInput!) {
    productCreate(product: $product) {
      product {
        id
        title
        handle
        status
        tags
        variants(first: 100) {
          edges {
            node {
              id
              title
              price
              compareAtPrice
              sku
            }
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const PRODUCT_UPDATE_MUTATION = `#graphql
  mutation productUpdate($input: ProductInput!) {
    productUpdate(input: $input) {
      product {
        id
        title
        descriptionHtml
        images(first: 20) {
          edges {
            node {
              id
              url
              altText
            }
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const PRODUCT_VARIANT_BULK_UPDATE_MUTATION = `#graphql
  mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants {
        id
        price
        compareAtPrice
        sku
        weight
        weightUnit
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const COLLECTIONS_QUERY = `#graphql
  query collections($first: Int!, $after: String, $query: String) {
    collections(first: $first, after: $after, query: $query) {
      edges {
        node {
          id
          title
          handle
          productsCount {
            count
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const COLLECTION_CREATE_MUTATION = `#graphql
  mutation collectionCreate($input: CollectionInput!) {
    collectionCreate(input: $input) {
      collection {
        id
        title
        handle
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const COLLECTION_ADD_PRODUCTS_MUTATION = `#graphql
  mutation collectionAddProducts($id: ID!, $productIds: [ID!]!) {
    collectionAddProducts(id: $id, productIds: $productIds) {
      collection {
        id
        title
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const PRODUCTS_QUERY = `#graphql
  query products($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query) {
      edges {
        node {
          id
          title
          handle
          status
          descriptionHtml
          vendor
          productType
          tags
          featuredImage {
            url
            altText
          }
          images(first: 20) {
            edges {
              node {
                id
                url
                altText
              }
            }
          }
          variants(first: 100) {
            edges {
              node {
                id
                title
                price
                compareAtPrice
                sku
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const PUBLICATIONS_QUERY = `#graphql
  query publications {
    publications(first: 10) {
      edges {
        node {
          id
          name
        }
      }
    }
  }
`;

export const PUBLISHABLE_PUBLISH_MUTATION = `#graphql
  mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      publishable {
        ... on Product {
          id
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const STAGED_UPLOADS_CREATE_MUTATION = `#graphql
  mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters {
          name
          value
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const PRODUCT_CREATE_MEDIA_MUTATION = `#graphql
  mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media {
        ... on MediaImage {
          id
          image {
            url
            altText
          }
        }
      }
      mediaUserErrors {
        field
        message
      }
    }
  }
`;

export const PRODUCT_SET_MUTATION = `#graphql
  mutation productSet($input: ProductSetInput!) {
    productSet(input: $input) {
      product {
        id
        title
        handle
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;
