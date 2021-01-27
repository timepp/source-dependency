export const visjsTemplate = `
<!DOCTYPE html>
<html lang="en">
  <head>
    <title>Vis Network | Other | Clustering by Zoom Level</title>

    <script src="https://cdnjs.cloudflare.com/ajax/libs/vis/4.21.0/vis-network.min.js" integrity="sha512-GE9mKnPrTn2DY5AZuIC9yE6K4FF8T+9lsO7jwHn+RW9rEjnHzF/in0oGwlPzRwjhQ+oJiawmtfvleX+l6h5/cA==" crossorigin="anonymous"></script>

    <style type="text/css">
      #mynetwork {
        width: 100%;
        height: 600px;
        border: 1px solid lightgray;
      }

      p {
        max-width: 600px;
      }

      h4 {
        margin-bottom: 3px;
      }
    </style>
  </head>

  <body>
    <p>You can zoom in and out to cluster/decluster.</p>
    Stabilize when clustering:<input type="checkbox" id="stabilizeCheckbox" />
    <div id="mynetwork"></div>

    <script type="text/javascript">
      var clusterIndex = 0;
      var clusters = [];
      var lastClusterZoomLevel = 0;
      var clusterFactor = 0.9;

      // create an array with nodes
      // [{id:string, label:string}]
      var nodes = __NODES;

      // create an array with edges
      // [{from:string, to:string}]
      var edges = __EDGES;

      // create a network
      var container = document.getElementById("mynetwork");
      var data = {
        nodes: nodes,
        edges: edges,
      };
      var options = {
        layout: { randomSeed: 8 },
        physics: {     
            hierarchicalRepulsion: {
                centralGravity: 0.0,
                springLength: 100,
                springConstant: 0.01,
                nodeDistance: 500,
                damping: 0.09,
                avoidOverlap: 1
          },
        },
        layout: {

        },
        edges: {
            smooth: {
                enabled: true,
                type: "dynamic"
            }
        },
        nodes: {
            font: {
                size: 0
            }
        }
      };
      var network = new vis.Network(container, data, options);

      // set the first initial zoom level
      network.once("initRedraw", function () {
        if (lastClusterZoomLevel === 0) {
          lastClusterZoomLevel = network.getScale();
        }
      });

      // we use the zoom event for our clustering
      network.on("zoom", function (params) {
        if (params.direction == "-") {
          if (params.scale < lastClusterZoomLevel * clusterFactor) {
            makeClusters(params.scale);
            lastClusterZoomLevel = params.scale;
          }
        } else {
          openClusters(params.scale);
        }
      });

      // if we click on a node, we want to open it up!
      network.on("selectNode", function (params) {
        if (params.nodes.length == 1) {
          if (network.isCluster(params.nodes[0]) == true) {
            network.openCluster(params.nodes[0]);
          }
        }
      });

      // make the clusters
      function makeClusters(scale) {
        var clusterOptionsByData = {
          processProperties: function (clusterOptions, childNodes) {
            clusterIndex = clusterIndex + 1;
            var childrenCount = 0;
            for (var i = 0; i < childNodes.length; i++) {
              childrenCount += childNodes[i].childrenCount || 1;
            }
            clusterOptions.childrenCount = childrenCount;
            clusterOptions.label = "# " + childrenCount + "";
            clusterOptions.font = { size: childrenCount * 5 + 30 };
            clusterOptions.id = "cluster:" + clusterIndex;
            clusters.push({ id: "cluster:" + clusterIndex, scale: scale });
            return clusterOptions;
          },
          clusterNodeProperties: {
            borderWidth: 3,
            shape: "database",
            font: { size: 30 },
          },
        };
        network.clusterOutliers(clusterOptionsByData);
        if (document.getElementById("stabilizeCheckbox").checked === true) {
          // since we use the scale as a unique identifier, we do NOT want to fit after the stabilization
          network.setOptions({ physics: { stabilization: { fit: false } } });
          network.stabilize();
        }
      }

      // open them back up!
      function openClusters(scale) {
        var newClusters = [];
        var declustered = false;
        for (var i = 0; i < clusters.length; i++) {
          if (clusters[i].scale < scale) {
            network.openCluster(clusters[i].id);
            lastClusterZoomLevel = scale;
            declustered = true;
          } else {
            newClusters.push(clusters[i]);
          }
        }
        clusters = newClusters;
        if (
          declustered === true &&
          document.getElementById("stabilizeCheckbox").checked === true
        ) {
          // since we use the scale as a unique identifier, we do NOT want to fit after the stabilization
          network.setOptions({ physics: { stabilization: { fit: false } } });
          network.stabilize();
        }
      }
    </script>
  </body>
</html>
`
