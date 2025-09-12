var currentBid = ""
var currentCards = ""
var nextBid = "";
var dealer = "";

$(function() {
    updateCards()
    var cardSwap = new Draggable.Swappable(document.getElementById("bidding-cardbox"), {
        draggable: ".cardtile",
    })
    cardSwap.on('swappable:stop', () => {
        updateCards()
    });

    var bidTiles = []
    for (var box of ["bidbox", "east", "west", "north", "south"]) {
        bidTiles.push(document.getElementById("bidding-" + box))
    }
    var tileSwap = new Draggable.Swappable(bidTiles, {
        draggable: ".bidtile",
    })
    var lastTile = null

    tileSwap.on('swappable:swapped', (event) => {
        //console.log(event.dragEvent.source)
        var element = $(event.swappedElement)
        console.log()
        if (element.hasClass('bid-slot') && element.parent().attr("id") == "bidding-pass") {
            lastTile = element
        }
    });
    tileSwap.on('swappable:stop', () => {
        if (lastTile != null) {
            lastTile.remove()
        }
        updateBids()
    });
});

function randomCards() {
    var elements = ""
    for (suit of ["s", "h", "c", "d"]) {
        for (rank of ["2", "3", "4", "5", "6", "7", "8", "9", "t", "j", "q", "k", "a"]) {
            elements += "#bidding-" + suit + rank + ","
        }
    }
    elements = elements.substr(0, elements.length - 1)
    $(elements).shuffle()
    updateCards()
}

function updateCards() {
    currentCards = ""
    for (side of ["w", "s", "e", "n"]) {
        var spades = ""
        var hearts = ""
        var diamonds = ""
        var clubs = ""
        for (child of $("#bidding-" + side).children()) {
            var target = $($(child).children().first())
            var id = target.attr("id")
            var suit = id.substr(id.length - 2, 1)
            if (suit == "c") {
                clubs += id.substr(id.length - 1)
            }
            if (suit == "d") {
                diamonds += id.substr(id.length - 1)
            }
            if (suit == "h") {
                hearts += id.substr(id.length - 1)
            }
            if (suit == "s") {
                spades += id.substr(id.length - 1)
            }
        }
        currentCards = currentCards + side + "=" + spades + "." + hearts + "." + diamonds + "." + clubs + "&"
    }
    console.log("Updated cards to " + currentCards)
}

function updateBids() {
    var bids = [{
        bids: [],
        name: "north"
    }, {
        bids: [],
        name: "east"
    }, {
        bids: [],
        name: "south"
    }, {
        bids: [],
        name: "west"
    }]
    dealer = ""
    for (obj of bids) {
        var name = obj.name
        var bid = obj.bids
        var index = -1
        bid.length = 0
        for (child of $("#bidding-" + name).children().first().children()) {
            index++
            var target = $($(child).children().first())
            if (target.attr("id") == undefined) {
                if (index > 0) {
                    continue
                }
                bid.push(undefined)
                continue
            }
            var id = target.attr("id")
            if (dealer == "" && index == 0) {
                dealer = name
            }
            if (id.includes("pass")) {
                bid.push("p")
                continue
            }
            if (id.includes("xx")) {
                bid.push("xx")
                continue
            }
            if (id.includes("x")) {
                bid.push("x")
                continue
            }
            if (id.includes("clubs")) {
                bid.push(id.substr(id.length - 1) + "c")
                continue
            }
            if (id.includes("diamonds")) {
                bid.push(id.substr(id.length - 1) + "d")
                continue
            }
            if (id.includes("hearts")) {
                bid.push(id.substr(id.length - 1) + "h")
                continue
            }
            if (id.includes("spades")) {
                bid.push(id.substr(id.length - 1) + "s")
                continue
            }
            if (id.includes("notrump")) {
                bid.push(id.substr(id.length - 1) + "n")
                continue
            }
        }
    }
    var lastbid = ""
    var nextbid = ""
    currentBid = "h="
    for (var i = 0; i < 7; i++) {
        var bidIndex = 0
        for (obj of bids) {
            bidIndex++
            if (obj.bids[i] == undefined) {
                continue
            }
            if (lastbid == obj.name) {
                console.log(obj.name)
                $("#bidding-selection").attr("class", "")
                $("#bidding-bid").text("")
                $("#bidding-meaning").text("")
                $("#bidding-error").text(obj.name.charAt(0).toUpperCase() + obj.name.slice(1) + " bid out of order! This will confuse GIB!")
                return
            }
            currentBid = currentBid + obj.bids[i] + "-"
            lastbid = obj.name
            if (bidIndex == 4) {
                bidIndex = 0
            }
            nextbid = bids[bidIndex].name
        }
        if (lastbid == "") {
            currentBid = ""
            $("#bidding-error").text("GIB cannot bid first! If you want GIB to open, bid pass fist!")
            return
        }
    }
    if (currentBid.includes("p-p-p-p")) {
        $("#bidding-selection").attr("class", "")
        $("#bidding-bid").text("")
        $("#bidding-meaning").text("")
        $("#bidding-error").text("All players passed during a round! This will confuse GIB!")
        return
    }
    currentBid = currentBid.substr(0, currentBid.length - 1)
    nextBid = nextbid
    console.log("Current bid is " + currentBid)
    console.log("Next to bid is " + nextbid)
    console.log("Dealer is " + dealer)
    callGIB()
}

function callGIB() {
    var sc = "tp"
    var pov = "N"
    if (nextBid == "south") {
        pov = "S"
    } else if (nextBid == "west") {
        pov = "W"
    } else if (nextBid == "east") {
        pov = "E"
    }
    var d = "N"
    if (dealer == "south") {
        d = "S"
    } else if (dealer == "west") {
        d = "W"
    } else if (dealer == "east") {
        d = "E"
    }
    var request = "https://gibrest.bridgebase.com/u_bm/robot.php?sc=" + sc + "&pov=" + pov + "&d=" + d + "&v=-&" + currentCards + currentBid
    console.log(request)
    httpGet(request, (responseText) => {
        var bid = "p"
        var suit = ""
        var parser = new DOMParser();
        var xml = parser.parseFromString(responseText, "text/xml")
        var value = xml.getElementsByTagName("r")[0]
        var meaning = ""
        console.log(xml)
        if (value == undefined) {
            $("#bidding-selection").attr("class", "")
            $("#bidding-bid").text("")
            $("#bidding-meaning").text("")
            $("#bidding-error").text("You did something to confuse GIB! Is your bid order legal?")
            return
        }
        if (value.getAttribute("type") == "bid") {
            var b = value.getAttribute("bid").toLowerCase()
            console.log(b)
            if (b != "p") {
                if (b == "xx") {
                    bid = "xx";
                } else if (b == "x") {
                    bid = "x"
                } else if (b.includes("c")) {
                    suit = "clubs"
                    bid = b.substr(0, 1)
                } else if (b.includes("d")) {
                    suit = "diamonds"
                    bid = b.substr(0, 1)
                } else if (b.includes("h")) {
                    suit = "hearts"
                    bid = b.substr(0, 1)
                } else if (b.includes("s")) {
                    suit = "spades"
                    bid = b.substr(0, 1)
                } else if (b.includes("n")) {
                    suit = "notrump"
                    bid = b.substr(0, 1)
                }
            }
        }
        if(value.getAttribute("meaning") != undefined) {
          meaning = value.getAttribute("meaning").replace("!H", "\u2665").replace("!S", "\u2660").replace("!D", "\u2666").replace("!C", "\u2663")
        }
        $("#bidding-error").text("")
        $("#bidding-bid").text("GIB bid for " + nextBid + ":")
        $("#bidding-meaning").text(meaning)
        if (bid == "p") {
            $("#bidding-selection").attr("class", "selecttile bid-pass bid-pass-symbol")
        } else if (bid == "x") {
            $("#bidding-selection").attr("class", "selecttile bid-pass bid-x bid-x-symbol")
        } else if (bid == "xx") {
            $("#bidding-selection").attr("class", "selecttile bid-pass bid-xx bid-xx-symbol")
        } else {
            $("#bidding-selection").attr("class", "selecttile bid-" + suit + " bid-" + suit + "-symbol " + "bid-" + suit + "-" + bid)
        }
    })
}

function httpGet(theUrl, callback) {
    var xmlHttp = new XMLHttpRequest()
    xmlHttp.onreadystatechange = function() {
        if (xmlHttp.readyState == 4 && xmlHttp.status == 200)
            callback(xmlHttp.responseText)
    }
    xmlHttp.open("GET", theUrl, true)
    xmlHttp.send(null)
}

(function($) {

    $.fn.shuffle = function() {

        var allElems = this.get(),
            getRandom = function(max) {
                return Math.floor(Math.random() * max);
            },
            shuffled = $.map(allElems, function() {
                var random = getRandom(allElems.length),
                    randEl = $(allElems[random]).clone(true)[0];
                allElems.splice(random, 1);
                return randEl;
            });

        this.each(function(i) {
            $(this).replaceWith($(shuffled[i]));
        });

        return $(shuffled);

    };

})(jQuery);